import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { initEmailWorker, closeEmailWorker } from '../worker/emailWorker';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

describe('End-to-End Email Worker & Ethereal Delivery Test', () => {
  const app = createApp();
  let worker: ReturnType<typeof initEmailWorker> = null;

  after(async () => {
    if (worker) {
      await closeEmailWorker();
    }
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  it('should schedule an email immediately, process via worker, send via Ethereal, and update MySQL status to SENT', async () => {
    // Start worker
    worker = initEmailWorker();
    assert.ok(worker, 'Worker should be initialized');

    // Schedule an email with 0 delay (immediate execution)
    const res = await request(app)
      .post('/api/emails/schedule')
      .send({
        sender: `e2e-worker-${Date.now()}@outbox.labs`,
        recipient: 'hiring.team@outbox.labs',
        subject: 'Phase 2 End-to-End Ethereal Delivery Verification',
        body: 'Hello Outbox Labs team, this email was scheduled and dispatched via BullMQ and Ethereal SMTP.',
        scheduledAt: new Date().toISOString(),
      });

    assert.equal(res.status, 201);
    const emailId = res.body.email.id;
    assert.ok(emailId);

    // Poll database for up to 15 seconds to wait for worker to pick up and dispatch
    let finalRecord = null;
    const maxWaitMs = 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      finalRecord = await EmailJobRepository.findById(emailId);
      if (finalRecord && (finalRecord.status === 'SENT' || finalRecord.status === 'FAILED')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    assert.ok(finalRecord, 'Email record must exist in database');
    console.log(`[E2E Test] Record final status: ${finalRecord.status}`);
    if (finalRecord.ethereal_preview_url) {
      console.log(`[E2E Test] Preview URL: ${finalRecord.ethereal_preview_url}`);
    }

    assert.equal(finalRecord.status, 'SENT', `Expected email status to be SENT but got ${finalRecord.status}. Error: ${finalRecord.error_message}`);
    assert.ok(finalRecord.ethereal_message_id, 'Must contain ethereal_message_id');
    assert.ok(finalRecord.sent_at, 'Must record sent_at timestamp');

    // Shut down worker immediately to avoid leaking into subsequent tests
    await closeEmailWorker();
    worker = null;
  });
});
