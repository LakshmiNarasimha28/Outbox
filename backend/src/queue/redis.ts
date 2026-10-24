import Redis, { RedisOptions } from 'ioredis';
import { env } from '../config/env';

export interface RedisHealthStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
  endpoint?: string;
}

/**
 * Checks whether hosted Redis connection details are configured in the environment.
 * Does not replace missing settings with localhost defaults.
 */
export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL || env.REDIS_HOST);
}

/**
 * Returns a masked endpoint string for logging and verification reports.
 * Never leaks passwords or auth tokens.
 */
export function getMaskedRedisEndpoint(): string {
  if (env.REDIS_URL) {
    try {
      const parsed = new URL(env.REDIS_URL);
      const user = parsed.username ? `${parsed.username}:***@` : '***@';
      return `${parsed.protocol}//${user}${parsed.hostname}:${parsed.port || 6379}`;
    } catch {
      return '[MASKED REDIS_URL]';
    }
  }

  if (env.REDIS_HOST) {
    const proto = env.REDIS_TLS ? 'rediss' : 'redis';
    const user = env.REDIS_USERNAME ? `${env.REDIS_USERNAME}:***@` : (env.REDIS_PASSWORD ? '***@' : '');
    return `${proto}://${user}${env.REDIS_HOST}:${env.REDIS_PORT || 6379}`;
  }

  return 'Not configured';
}

/**
 * Common Redis configuration options required by BullMQ and ioredis.
 * BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`.
 * Supports hosted Redis via REDIS_URL or discrete variables (with TLS).
 */
export function getRedisConfig(): RedisOptions {
  if (env.REDIS_URL) {
    try {
      const parsed = new URL(env.REDIS_URL);
      const isTls = parsed.protocol === 'rediss:' || env.REDIS_TLS === true;
      return {
        host: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : 6379,
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        db:
          parsed.pathname && parsed.pathname.length > 1
            ? parseInt(parsed.pathname.slice(1), 10) || 0
            : env.REDIS_DB,
        tls: isTls ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 8000,
        retryStrategy(times) {
          return Math.min(times * 100, 3000);
        },
      };
    } catch {
      // If URL parsing fails, pass standard options
    }
  }

  if (env.REDIS_HOST) {
    return {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT || 6379,
      username: env.REDIS_USERNAME || undefined,
      password: env.REDIS_PASSWORD || undefined,
      db: env.REDIS_DB,
      tls: env.REDIS_TLS ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      connectTimeout: 8000,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    };
  }

  // Unconfigured state: empty host to avoid default localhost assumptions
  return {
    host: '',
    port: 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  };
}

let sharedRedisClient: Redis | null = null;

export function getSharedRedisClient(): Redis | null {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!sharedRedisClient) {
    sharedRedisClient = new Redis(getRedisConfig());
    sharedRedisClient.on('error', (err) => {
      console.warn(`[Redis Notice] Connection issue: ${err.message}`);
    });
  }
  return sharedRedisClient;
}

/**
 * Safely tests Redis connectivity with a ping command and latency measurement.
 * Never exposes secrets in logs or responses.
 */
export async function checkRedisConnection(): Promise<RedisHealthStatus> {
  const endpoint = getMaskedRedisEndpoint();

  if (!isRedisConfigured()) {
    return {
      connected: false,
      endpoint,
      error: 'Redis configuration is missing. Set REDIS_URL or REDIS_HOST in backend/.env',
    };
  }

  const start = Date.now();
  let client: Redis | null = null;
  try {
    const config = getRedisConfig();
    client = new Redis({
      ...config,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null, // Do not loop retries during isolated probe
    });

    // Suppress unhandled error log when Redis is offline or credentials fail
    client.on('error', () => {});

    await client.connect();
    const reply = await client.ping();
    const latencyMs = Date.now() - start;

    return {
      connected: reply === 'PONG',
      latencyMs,
      endpoint,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown Redis connection error';
    // Redact any possible secret leak in error messages
    const sanitized = rawMessage.replace(/([a-zA-Z0-9_-]+):([a-zA-Z0-9_\-~.+/%=]+)@/g, '$1:***@');

    return {
      connected: false,
      endpoint,
      error: sanitized,
    };
  } finally {
    if (client) {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  }
}

/**
 * Gracefully shuts down shared Redis client.
 */
export async function closeRedisConnection(): Promise<void> {
  if (sharedRedisClient) {
    try {
      await sharedRedisClient.quit();
    } catch {
      sharedRedisClient.disconnect();
    }
    sharedRedisClient = null;
  }
}
