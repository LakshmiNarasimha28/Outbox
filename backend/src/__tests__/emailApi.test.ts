import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

describe('Email Scheduling API Integration Tests', () => {
  const app = createApp();

  after(async () => {
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  it('POST /api/emails/schedule - should return 400 for invalid payload', async () => {
    const res = await request(app)
      .post('/api/emails/schedule')
      .send({ recipient: 'not-an-email', subject: '' });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Validation Error');
    assert.ok(Array.isArray(res.body.details));
  });

  it('POST /api/emails/schedule - should persist in MySQL and enqueue in BullMQ', async () => {
    const testIdemKey = `idem-test-${Date.now()}`;
    const futureDate = new Date(Date.now() + 120000).toISOString();

    const res = await request(app)
      .post('/api/emails/schedule')
      .send({
        recipient: 'candidate.test@example.com',
        subject: 'Welcome to Outbox Labs',
        body: 'This is a test background email job scheduled 2 minutes in the future.',
        scheduledAt: futureDate,
        idempotencyKey: testIdemKey,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.email);
    assert.equal(res.body.email.recipient, 'candidate.test@example.com');
    assert.equal(res.body.email.status, 'PENDING');
    assert.ok(res.body.jobId);
    assert.ok(res.body.jobId.startsWith('email-job-'));

    // Test idempotency: re-sending with identical idempotencyKey should return existing record
    const resDuplicate = await request(app)
      .post('/api/emails/schedule')
      .send({
        recipient: 'candidate.test@example.com',
        subject: 'Welcome to Outbox Labs',
        body: 'Different body, but same idempotency key.',
        idempotencyKey: testIdemKey,
      });

    assert.equal(resDuplicate.status, 200);
    assert.equal(resDuplicate.body.success, true);
    assert.equal(resDuplicate.body.idempotent, true);
    assert.equal(resDuplicate.body.email.id, res.body.email.id);
  });

  it('GET /api/emails - should list emails with pagination', async () => {
    const res = await request(app).get('/api/emails?limit=10&offset=0');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.total === 'number');
    assert.ok(Array.isArray(res.body.emails));
  });

  it('GET /api/emails/scheduled - should list currently pending/processing emails', async () => {
    const res = await request(app).get('/api/emails/scheduled');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.emails));
  });

  it('GET /api/emails/history - should list completed (sent/failed) emails', async () => {
    const res = await request(app).get('/api/emails/history');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.emails));
  });

  it('GET /api/emails/:id - should return 404 for non-existent ID', async () => {
    const res = await request(app).get('/api/emails/non-existent-uuid-000000');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});
