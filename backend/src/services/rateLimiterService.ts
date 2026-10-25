import crypto from 'crypto';
import { getSharedRedisClient } from '../queue/redis';
import { env } from '../config/env';

export class RateLimiterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimiterError';
  }
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  retryAfterMs: number;
  memberId?: string;
  sender: string;
}

export interface RateLimitUsage {
  sender: string;
  limit: number;
  count: number;
  remaining: number;
  windowMs: number;
  resetInMs: number;
}

/**
 * Atomic sliding-window rate limiter Lua script.
 * KEYS[1]: ratelimit:sender:{sender}
 * ARGV[1]: nowMs (current timestamp in ms)
 * ARGV[2]: windowMs (sliding window duration in ms)
 * ARGV[3]: limit (maximum allowed sends per window)
 * ARGV[4]: memberId (unique identifier for this send token)
 */
const SLIDING_WINDOW_LUA = `
  local key = KEYS[1]
  local nowMs = tonumber(ARGV[1])
  local windowMs = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local memberId = ARGV[4]

  -- 1. Purge expired entries older than the sliding window
  local windowStart = nowMs - windowMs
  redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

  -- 2. Count active entries in the current sliding window
  local currentCount = redis.call('ZCARD', key)

  -- 3. Check quota
  if currentCount < limit then
    -- Allowed! Record current send
    redis.call('ZADD', key, nowMs, memberId)
    local ttlSeconds = math.ceil(windowMs / 1000) + 60
    redis.call('EXPIRE', key, ttlSeconds)
    return { 1, currentCount + 1, 0 }
  else
    -- Limit reached! Find the oldest record still in window to calculate exact delay
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = windowMs
    if oldest and #oldest >= 2 then
      local oldestScore = tonumber(oldest[2])
      local timeUntilExpires = (oldestScore + windowMs) - nowMs
      if timeUntilExpires > 0 then
        retryAfterMs = timeUntilExpires
      else
        retryAfterMs = 1000
      end
    end
    return { 0, currentCount, retryAfterMs }
  end
`;

/**
 * Distributed hourly rate limiter utilizing hosted Redis and an atomic Lua sliding window.
 * Ensures consistent rate limiting across multiple distributed worker processes without in-memory state.
 */
export class RateLimiterService {
  /**
   * Generates a Redis key namespaced by sender.
   */
  public static getKey(sender: string): string {
    const normalized = sender.trim().toLowerCase();
    return `ratelimit:sender:${encodeURIComponent(normalized)}`;
  }

  /**
   * Persists a custom hourly limit for a sender in Redis.
   */
  public static async setSenderLimit(sender: string, limit: number): Promise<void> {
    const client = getSharedRedisClient();
    if (!client) return;
    const normalized = sender.trim().toLowerCase();
    await client.set(`ratelimit:config:${encodeURIComponent(normalized)}`, limit.toString(), 'EX', 86400);
  }

  /**
   * Retrieves the configured hourly limit for a sender from Redis if present.
   */
  public static async getSenderLimit(sender: string): Promise<number | null> {
    const client = getSharedRedisClient();
    if (!client) return null;
    const normalized = sender.trim().toLowerCase();
    try {
      const val = await client.get(`ratelimit:config:${encodeURIComponent(normalized)}`);
      return val ? parseInt(val, 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Atomically checks quota and records a send if under the limit.
   * Throws RateLimiterError if Redis fails or is unavailable to prevent silent bypasses.
   *
   * @param sender Email sender address
   * @param customLimit Optional limit override (defaults to sender limit or env.HOURLY_RATE_LIMIT)
   * @param customWindowMs Optional window duration override (defaults to env.RATE_LIMIT_WINDOW_MS)
   */
  public static async checkAndConsume(
    sender: string,
    customLimit?: number,
    customWindowMs?: number
  ): Promise<RateLimitResult> {
    const client = getSharedRedisClient();
    if (!client) {
      throw new RateLimiterError(
        'Redis is not configured. Cannot enforce distributed rate limits. Delivery halted.'
      );
    }

    let limit = customLimit;
    if (limit === undefined) {
      const configured = await this.getSenderLimit(sender);
      limit = configured !== null ? configured : env.HOURLY_RATE_LIMIT;
    }

    const windowMs = customWindowMs ?? env.RATE_LIMIT_WINDOW_MS;
    const key = this.getKey(sender);
    const nowMs = Date.now();
    const memberId = `${nowMs}:${crypto.randomUUID()}`;

    try {
      const rawResult = (await client.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        nowMs,
        windowMs,
        limit,
        memberId
      )) as [number, number, number];

      const allowed = rawResult[0] === 1;
      const currentCount = rawResult[1];
      const retryAfterMs = rawResult[2];

      return {
        allowed,
        currentCount,
        limit,
        retryAfterMs,
        memberId: allowed ? memberId : undefined,
        sender,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Redis error';
      throw new RateLimiterError(`Failed to execute rate limiter Lua script on Redis: ${message}`);
    }
  }

  /**
   * Refunds a consumed rate limit slot if downstream SMTP transmission fails.
   * Prevents penalizing a sender's quota for infrastructure errors.
   */
  public static async refund(sender: string, memberId: string): Promise<void> {
    const client = getSharedRedisClient();
    if (!client || !memberId) return;

    try {
      const key = this.getKey(sender);
      await client.zrem(key, memberId);
    } catch (err) {
      console.warn(`[RateLimiter] Failed to refund rate limit slot for ${sender}:`, err);
    }
  }

  /**
   * Retrieves current rate limit usage and remaining quota for a sender without consuming a slot.
   */
  public static async getUsage(
    sender: string,
    customLimit?: number,
    customWindowMs?: number
  ): Promise<RateLimitUsage> {
    const client = getSharedRedisClient();
    const limit = customLimit ?? env.HOURLY_RATE_LIMIT;
    const windowMs = customWindowMs ?? env.RATE_LIMIT_WINDOW_MS;

    if (!client) {
      throw new RateLimiterError('Redis is not configured. Cannot query rate limit telemetry.');
    }

    const key = this.getKey(sender);
    const nowMs = Date.now();
    const windowStart = nowMs - windowMs;

    try {
      // Clean expired
      await client.zremrangebyscore(key, '-inf', windowStart);
      const count = await client.zcard(key);

      let resetInMs = 0;
      if (count > 0) {
        const oldest = await client.zrange(key, 0, 0, 'WITHSCORES');
        if (oldest && oldest.length >= 2) {
          const oldestScore = parseInt(oldest[1], 10);
          resetInMs = Math.max(0, oldestScore + windowMs - nowMs);
        }
      }

      return {
        sender,
        limit,
        count,
        remaining: Math.max(0, limit - count),
        windowMs,
        resetInMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Redis error';
      throw new RateLimiterError(`Failed to retrieve rate limit usage from Redis: ${message}`);
    }
  }

  /**
   * Resets the rate limit key for a sender. Intended for testing and administrative resets.
   */
  public static async reset(sender: string): Promise<void> {
    const client = getSharedRedisClient();
    if (!client) return;

    try {
      const key = this.getKey(sender);
      await client.del(key);
    } catch (err) {
      console.warn(`[RateLimiter] Failed to reset rate limit key for ${sender}:`, err);
    }
  }
}
