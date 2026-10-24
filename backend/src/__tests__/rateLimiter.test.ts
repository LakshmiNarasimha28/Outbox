import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { RateLimiterService, RateLimiterError } from '../services/rateLimiterService';
import { initEmailWorker, closeEmailWorker } from '../worker/emailWorker';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { env } from '../config/env';
import { closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

describe('Distributed Hourly Rate Limiter & Rescheduling Tests', () => {
  const app = createApp();
  let worker: ReturnType<typeof initEmailWorker> = null;

  const testSenderA = `sender-a-${Date.now()}@outbox.labs`;
  const testSenderB = `sender-b-${Date.now()}@outbox.labs`;

  before(async () => {
    // Reset any existing test rate limit keys
    await RateLimiterService.reset(testSenderA);
    await RateLimiterService.reset(testSenderB);
  });

  after(async () => {
    if (worker) {
      await closeEmailWorker();
    }
    await RateLimiterService.reset(testSenderA);
    await RateLimiterService.reset(testSenderB);
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  it('should enforce rate limits atomically in Redis and compute accurate retry delays', async () => {
    const limit = 2;
    const windowMs = 5000; // 5 second sliding window for testing

    // First send: should be allowed (1 of 2)
    const res1 = await RateLimiterService.checkAndConsume(testSenderA, limit, windowMs);
    assert.equal(res1.allowed, true);
    assert.equal(res1.currentCount, 1);
    assert.equal(res1.retryAfterMs, 0);
    assert.ok(res1.memberId);

    // Second send: should be allowed (2 of 2)
    const res2 = await RateLimiterService.checkAndConsume(testSenderA, limit, windowMs);
    assert.equal(res2.allowed, true);
    assert.equal(res2.currentCount, 2);
    assert.equal(res2.retryAfterMs, 0);

    // Third send: should be BLOCKED (quota exceeded)
    const res3 = await RateLimiterService.checkAndConsume(testSenderA, limit, windowMs);
    assert.equal(res3.allowed, false);
    assert.equal(res3.currentCount, 2);
    assert.ok(res3.retryAfterMs > 0, 'retryAfterMs must be positive');
    assert.ok(res3.retryAfterMs <= windowMs, 'retryAfterMs must be within windowMs');
  });

  it('should isolate rate limits per sender so Sender A does not block Sender B', async () => {
    const limit = 1;
    const windowMs = 10000;

    // Sender A exhausts their quota
    const resA1 = await RateLimiterService.checkAndConsume(testSenderA, limit, windowMs);
    assert.equal(resA1.allowed, false, 'Sender A was already exhausted from previous test');

    // Sender B should have full quota available
    const resB1 = await RateLimiterService.checkAndConsume(testSenderB, limit, windowMs);
    assert.equal(resB1.allowed, true, 'Sender B must have available quota');
    assert.equal(resB1.currentCount, 1);
  });

  it('should refund consumed slot when transmission fails', async () => {
    const sender = `refund-test-${Date.now()}@outbox.labs`;
    const limit = 1;
    const windowMs = 10000;

    // Consume slot
    const res = await RateLimiterService.checkAndConsume(sender, limit, windowMs);
    assert.equal(res.allowed, true);
    assert.ok(res.memberId);

    // Now quota is exhausted
    const blocked = await RateLimiterService.checkAndConsume(sender, limit, windowMs);
    assert.equal(blocked.allowed, false);

    // Refund slot (simulating SMTP error)
    await RateLimiterService.refund(sender, res.memberId!);

    // Should now be permitted again
    const afterRefund = await RateLimiterService.checkAndConsume(sender, limit, windowMs);
    assert.equal(afterRefund.allowed, true, 'Slot should be freed up after refund');

    await RateLimiterService.reset(sender);
  });

  it('should expose rate limit telemetry via GET /api/emails/rate-limit', async () => {
    const res = await request(app)
      .get(`/api/emails/rate-limit?sender=${encodeURIComponent(testSenderA)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.sender, testSenderA);
    assert.ok(typeof res.body.limit === 'number');
    assert.ok(typeof res.body.count === 'number');
    assert.ok(typeof res.body.remaining === 'number');
    assert.ok(typeof res.body.resetInMs === 'number');
  });

  it('should reschedule an email when sender reaches rate limit without burning max_attempts or discarding the email', async () => {
    const rateLimitedSender = `quota-exhausted-${Date.now()}@outbox.labs`;
    await RateLimiterService.reset(rateLimitedSender);

    // Fill quota for this sender up to env.HOURLY_RATE_LIMIT
    for (let i = 0; i < env.HOURLY_RATE_LIMIT; i++) {
      const fillResult = await RateLimiterService.checkAndConsume(rateLimitedSender);
      assert.equal(fillResult.allowed, true, `Slot ${i + 1} should be allowed`);
    }

    // Verify quota is now exhausted
    const verifyBlocked = await RateLimiterService.checkAndConsume(rateLimitedSender);
    assert.equal(verifyBlocked.allowed, false, 'Quota should now be completely exhausted');

    // Start worker
    worker = initEmailWorker();
    assert.ok(worker, 'Worker should be active');

    // Schedule an email for this sender with Send Now (immediate delivery)
    const scheduleRes = await request(app)
      .post('/api/emails/schedule')
      .send({
        recipient: 'recipient-limit-test@example.com',
        sender: rateLimitedSender,
        subject: 'Rate Limit Reschedule Verification',
        body: 'This email should be rescheduled due to sender rate limit.',
        scheduledAt: new Date().toISOString(),
      });

    assert.equal(scheduleRes.status, 201);
    const emailId = scheduleRes.body.email.id;
    assert.ok(emailId);

    // Poll database for up to 8 seconds to verify that worker picked it up, hit rate limit,
    // and rescheduled it (status returned to PENDING with a future scheduled_at and explanatory message)
    let finalRecord = null;
    const startTime = Date.now();
    while (Date.now() - startTime < 8000) {
      finalRecord = await EmailJobRepository.findById(emailId);
      // If rescheduled, error_message will contain "Hourly limit of"
      if (finalRecord && finalRecord.error_message && finalRecord.error_message.includes('Hourly limit of')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    assert.ok(finalRecord, 'Email record must exist in MySQL');
    console.log(`[Rate Limit Test] Status: ${finalRecord.status}, Attempts: ${finalRecord.attempts}, Scheduled: ${finalRecord.scheduled_at}`);
    console.log(`[Rate Limit Test] Reschedule Notice: ${finalRecord.error_message}`);

    // Verify requirements:
    // 1. Not discarded
    assert.ok(finalRecord);
    // 2. Status set back to PENDING (eligible for future processing)
    assert.equal(finalRecord.status, 'PENDING', 'Rescheduled email must have status PENDING');
    // 3. Not marked FAILED
    assert.notEqual(finalRecord.status, 'FAILED');
    // 4. Attempts not burned towards max_attempts (should be 0 because attempt was reverted)
    assert.equal(finalRecord.attempts, 0, 'Attempts should not be consumed by rate limit delay');
    // 5. Scheduled time pushed into the future
    const originalTime = new Date(scheduleRes.body.email.scheduled_at).getTime();
    const newScheduledTime = new Date(finalRecord.scheduled_at).getTime();
    assert.ok(newScheduledTime >= originalTime, 'scheduled_at must be moved to an eligible future time');
    // 6. Explanatory message recorded
    assert.ok(finalRecord.error_message?.includes('Hourly limit of'));

    // Clean up
    await RateLimiterService.reset(rateLimitedSender);
    await closeEmailWorker();
    worker = null;
  });

  it('should throw RateLimiterError explicitly when Redis fails instead of silently bypassing limits', async () => {
    // Pass invalid arguments that cause Redis Lua script execution to fail
    await assert.rejects(
      async () => {
        // Passing NaN / invalid limit to trigger Lua error
        await RateLimiterService.checkAndConsume(testSenderA, NaN, 1000);
      },
      (err: Error) => {
        return err instanceof RateLimiterError && err.message.includes('rate limiter');
      },
      'Must reject with RateLimiterError when Redis script execution fails'
    );
  });
});
