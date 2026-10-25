import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { initEmailWorker, closeEmailWorker } from '../worker/emailWorker';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { getEmailQueue, closeEmailQueue } from '../queue/emailQueue';

describe('Worker Restart & Delayed Job Recovery Test', () => {
  const app = createApp();
  let worker: ReturnType<typeof initEmailWorker> = null;

  after(async () => {
    if (worker) {
      await closeEmailWorker();
    }
    const queue = getEmailQueue();
    if (queue) {
      try {
        await queue.resume();
      } catch {}
    }
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  it('should preserve delayed jobs in Redis during backend downtime and process them immediately upon worker restart', async () => {
    // 1. Ensure worker is stopped and queue is paused to isolate against external dev server workers
    await closeEmailWorker();
    const queue = getEmailQueue();
    if (queue) {
      await queue.pause();
    }

    // 2. Schedule an email with a 3-second future delay
    const targetTime = new Date(Date.now() + 3000).toISOString();
    const res = await request(app)
      .post('/api/emails/schedule')
      .send({
        sender: `restart-recovery-${Date.now()}@outbox.labs`,
        recipient: 'restart.verification@outbox.labs',
        subject: 'Phase 2 Worker Restart Test',
        body: 'Verifying that BullMQ preserves delayed jobs across worker process restarts.',
        scheduledAt: targetTime,
      });

    assert.equal(res.status, 201);
    const emailId = res.body.email.id;
    assert.ok(emailId);

    // 3. Confirm email is in MySQL with status 'PENDING' while worker is dead
    const pendingRecord = await EmailJobRepository.findById(emailId);
    assert.ok(pendingRecord);
    assert.equal(pendingRecord.status, 'PENDING');

    console.log(`[Restart Test] Email ${emailId} queued. Worker is OFFLINE. Sleeping 4 seconds...`);

    // 4. Sleep for 4 seconds so target scheduled time passes while worker is completely stopped
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // Status should still be PENDING in DB because worker was dead
    const stillPending = await EmailJobRepository.findById(emailId);
    assert.equal(stillPending?.status, 'PENDING', 'Email must remain PENDING while worker is offline');

    console.log(`[Restart Test] Target time passed. Simulating backend / worker restart...`);

    // 5. Restart worker and resume queue
    if (queue) {
      await queue.resume();
    }
    worker = initEmailWorker();
    assert.ok(worker, 'Worker restarted successfully');

    // 6. Wait for worker to consume the delayed job from Redis and deliver it
    let deliveredRecord = null;
    const maxWaitMs = 25000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      deliveredRecord = await EmailJobRepository.findById(emailId);
      if (deliveredRecord && deliveredRecord.status === 'SENT') {
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    assert.ok(deliveredRecord);
    console.log(`[Restart Test] Email ${emailId} final status after restart: ${deliveredRecord.status}`);
    assert.equal(deliveredRecord.status, 'SENT', 'Job should be picked up and processed to SENT after restart');
    assert.ok(deliveredRecord.ethereal_message_id, 'Should have message ID');
    assert.ok(deliveredRecord.ethereal_preview_url, 'Should have Ethereal preview URL');
  });
});
