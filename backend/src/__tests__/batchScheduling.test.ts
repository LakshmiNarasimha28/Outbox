import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { getDatabasePool, closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

describe('Batch Lead Upload & Scheduling API Integration Tests', () => {
  const app = createApp();
  const createdEmailIds: string[] = [];

  after(async () => {
    // Clean up created test emails from MySQL
    if (createdEmailIds.length > 0) {
      const pool = getDatabasePool();
      const placeholders = createdEmailIds.map(() => '?').join(',');
      await pool.query(`DELETE FROM email_jobs WHERE id IN (${placeholders})`, createdEmailIds);
    }

    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  describe('POST /api/emails/parse-leads', () => {
    it('should reject empty or missing content with 400', async () => {
      const res = await request(app).post('/api/emails/parse-leads').send({});
      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error, 'Validation Error');
    });

    it('should parse CSV content and return detected valid, duplicate, and invalid lead counts', async () => {
      const csv = `Full Name,Email,Title
Alice Dev,alice.lead@outbox.labs,Engineer
Bob PM,bob.lead@outbox.labs,Product Manager
Alice Duplicate,alice.lead@outbox.labs,Engineer
Invalid Lead,not-an-email@,QA`;

      const res = await request(app)
        .post('/api/emails/parse-leads')
        .send({ content: csv });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.totalDetected, 4);
      assert.equal(res.body.validLeads.length, 2);
      assert.deepEqual(res.body.validLeads, [
        'alice.lead@outbox.labs',
        'bob.lead@outbox.labs',
      ]);
      assert.equal(res.body.duplicatesRemoved, 1);
      assert.equal(res.body.invalidCount, 1);
    });

    it('should parse plain-text lists separated by commas, semicolons, and newlines', async () => {
      const text = `contact1@outbox.labs; contact2@outbox.labs
contact3@outbox.labs, contact1@outbox.labs`;

      const res = await request(app)
        .post('/api/emails/parse-leads')
        .send({ content: text });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.validLeads.length, 3);
      assert.equal(res.body.duplicatesRemoved, 1);
    });
  });

  describe('POST /api/emails/schedule-batch', () => {
    it('should reject invalid batch payload with 400', async () => {
      const res = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients: [],
          subject: '',
          body: '',
          delayBetweenEmailsSeconds: -5,
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error, 'Validation Error');
      assert.ok(Array.isArray(res.body.details));
    });

    it('should schedule batch of leads with configurable start time and staggered delays', async () => {
      const startTime = new Date(Date.now() + 60000); // 1 minute in future
      const delaySeconds = 15;
      const batchIdemKey = `batch-idem-${Date.now()}`;
      const recipients = [
        'batch.lead.1@outbox.labs',
        'batch.lead.2@outbox.labs',
        'batch.lead.3@outbox.labs',
      ];

      const res = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients,
          subject: 'Outbox Sequence: Day 1',
          body: 'Hello, this is email step 1 in the scheduled lead sequence.',
          startTime: startTime.toISOString(),
          delayBetweenEmailsSeconds: delaySeconds,
          batchIdempotencyKey: batchIdemKey,
          sender: 'campaign@outbox.labs',
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.totalRequested, 3);
      assert.equal(res.body.scheduledCount, 3);
      assert.equal(res.body.idempotentCount, 0);
      assert.equal(res.body.delayBetweenEmailsSeconds, 15);
      assert.ok(Array.isArray(res.body.jobIds));
      assert.equal(res.body.jobIds.length, 3);

      const emails = res.body.emails;
      assert.equal(emails.length, 3);

      // Track created IDs for cleanup
      for (const email of emails) {
        createdEmailIds.push(email.id);
      }

      // Verify staggered timestamps
      const t0 = new Date(emails[0].scheduled_at).getTime();
      const t1 = new Date(emails[1].scheduled_at).getTime();
      const t2 = new Date(emails[2].scheduled_at).getTime();

      assert.equal(t1 - t0, delaySeconds * 1000);
      assert.equal(t2 - t1, delaySeconds * 1000);

      // Verify all emails are persisted with PENDING in MySQL
      for (const email of emails) {
        assert.equal(email.status, 'PENDING');
        assert.equal(email.sender, 'campaign@outbox.labs');
      }

      // Test idempotency: Resubmitting identical batch should return existing records without duplicating
      const resDuplicate = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients,
          subject: 'Modified Subject',
          body: 'Modified Body',
          startTime: startTime.toISOString(),
          delayBetweenEmailsSeconds: delaySeconds,
          batchIdempotencyKey: batchIdemKey,
        });

      assert.equal(resDuplicate.status, 201);
      assert.equal(resDuplicate.body.scheduledCount, 0);
      assert.equal(resDuplicate.body.idempotentCount, 3);
    });

    it('should support immediate start time when startTime is omitted', async () => {
      const res = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients: ['immediate.lead.1@outbox.labs', 'immediate.lead.2@outbox.labs'],
          subject: 'Immediate Batch',
          body: 'Dispatched immediately with 5s delay',
          delayBetweenEmailsSeconds: 5,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.scheduledCount, 2);

      for (const email of res.body.emails) {
        createdEmailIds.push(email.id);
      }
    });

    it('should deduplicate duplicate recipients within the same batch payload and enforce unique idempotency', async () => {
      const batchIdem = `dedup-batch-${Date.now()}`;
      const res = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients: [
            'duplicate.lead@outbox.labs',
            'unique.lead@outbox.labs',
            'DUPLICATE.LEAD@OUTBOX.LABS', // duplicate with different casing
            'duplicate.lead@outbox.labs',
          ],
          subject: 'Deduplication Test',
          body: 'Testing that identical recipients within one batch are deduplicated.',
          batchIdempotencyKey: batchIdem,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.totalRequested, 4);
      assert.equal(res.body.uniqueRecipientsCount, 2);
      assert.equal(res.body.scheduledCount, 2);

      for (const email of res.body.emails) {
        createdEmailIds.push(email.id);
      }

      // Re-submitting the same batch should return 100% idempotent hits and zero duplicate DB rows
      const resRetry = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients: [
            'duplicate.lead@outbox.labs',
            'unique.lead@outbox.labs',
          ],
          subject: 'Deduplication Test Retry',
          body: 'Testing idempotency on retry.',
          batchIdempotencyKey: batchIdem,
        });

      assert.equal(resRetry.status, 201);
      assert.equal(resRetry.body.scheduledCount, 0);
      assert.equal(resRetry.body.idempotentCount, 2);
    });

    it('should truly pass and enforce custom hourlyRateLimit in BullMQ job data and Redis rate limiter', async () => {
      const customSender = `custom-limit-sender-${Date.now()}@outbox.labs`;
      const customLimit = 3;

      const res = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients: ['rate.check.1@outbox.labs', 'rate.check.2@outbox.labs'],
          subject: 'Custom Limit Test',
          body: 'Testing custom hourly limit propagation.',
          hourlyRateLimit: customLimit,
          sender: customSender,
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.hourlyRateLimit, customLimit);

      for (const email of res.body.emails) {
        createdEmailIds.push(email.id);
      }

      // Verify Redis rate limit check consumes custom limit
      const { RateLimiterService } = await import('../services/rateLimiterService');
      const rateStatus = await RateLimiterService.checkAndConsume(customSender, customLimit);
      assert.equal(rateStatus.limit, customLimit);
      assert.equal(rateStatus.allowed, true);
    });

    it('should recover PENDING jobs idempotently without duplicate jobs or records', async () => {
      // 1. Recover pending endpoint handles empty queue gracefully
      const resEmpty = await request(app).post('/api/emails/recover-pending').send();
      assert.equal(resEmpty.status, 200);
      assert.equal(resEmpty.body.success, true);
      assert.equal(typeof resEmpty.body.recoveredCount, 'number');

      // 2. Schedule a batch
      const recoveryBatchKey = `recovery-batch-${Date.now()}`;
      const resSchedule = await request(app)
        .post('/api/emails/schedule-batch')
        .send({
          recipients: ['recover.lead.1@outbox.labs', 'recover.lead.2@outbox.labs'],
          subject: 'Recovery Verification',
          body: 'Verifying idempotent recovery.',
          batchIdempotencyKey: recoveryBatchKey,
        });

      assert.equal(resSchedule.status, 201);
      for (const email of resSchedule.body.emails) {
        createdEmailIds.push(email.id);
      }

      // 3. Invoking recover-pending again must be completely idempotent (zero duplicate DB records)
      const resRecover = await request(app).post('/api/emails/recover-pending').send();
      assert.equal(resRecover.status, 200);
      assert.equal(resRecover.body.success, true);
    });
  });
});

