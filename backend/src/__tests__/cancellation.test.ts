import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app';
import { AuthService, AuthUser } from '../services/authService';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { getDatabasePool, closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { getEmailQueue, scheduleEmailJob, closeEmailQueue } from '../queue/emailQueue';

describe('Scheduled Email Cancellation & Race-Safety Regression Tests', () => {
  const app = createApp();

  const userA: AuthUser = {
    id: `cancel-user-a-${Date.now()}`,
    email: 'user.a@cancel-test.com',
    name: 'User A',
    avatar: null,
  };
  const tokenA = AuthService.signSessionToken(userA);
  const cookieA = `${AuthService.SESSION_COOKIE_NAME}=${tokenA}`;

  const userB: AuthUser = {
    id: `cancel-user-b-${Date.now()}`,
    email: 'user.b@cancel-test.com',
    name: 'User B',
    avatar: null,
  };
  const tokenB = AuthService.signSessionToken(userB);
  const cookieB = `${AuthService.SESSION_COOKIE_NAME}=${tokenB}`;

  const createdJobIds: string[] = [];

  after(async () => {
    const pool = getDatabasePool();
    if (createdJobIds.length > 0) {
      const placeholders = createdJobIds.map(() => '?').join(', ');
      await pool.query(`DELETE FROM email_jobs WHERE id IN (${placeholders})`, createdJobIds);
    }
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  it('should successfully cancel a pending scheduled email, update MySQL, and remove it from BullMQ', async () => {
    // 1. Create a pending job for User A scheduled 10 minutes in the future
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'cancel.target@example.com',
      subject: 'Scheduled Email To Cancel',
      body: 'Will be cancelled before send',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // 2. Enqueue in BullMQ delayed storage
    await scheduleEmailJob(job);
    const queue = getEmailQueue();
    const bullJobBefore = await queue?.getJob(`email-job-${job.id}`);
    assert.ok(bullJobBefore, 'BullMQ job should exist before cancellation');

    // 3. Authenticated cancellation request
    const res = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.email.status, 'CANCELLED');
    assert.equal(res.body.message, 'Email scheduled job cancelled successfully');

    // 4. Verify database state
    const dbRecord = await EmailJobRepository.findById(job.id);
    assert.ok(dbRecord);
    assert.equal(dbRecord.status, 'CANCELLED');
    assert.equal(dbRecord.error_message, 'Cancelled by user');

    // 5. Verify BullMQ delayed job was safely removed
    const bullJobAfter = await queue?.getJob(`email-job-${job.id}`);
    assert.equal(bullJobAfter, undefined, 'BullMQ job should be removed after cancellation');
  });

  it('should enforce strict ownership: User B cannot cancel User A email (returns 403 Forbidden)', async () => {
    const jobA = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'user.a.private@example.com',
      subject: 'User A Private Dispatch',
      body: 'Tenant confidential',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(jobA.id);

    // User B attempts to cancel User A's job
    const res = await request(app)
      .post(`/api/emails/${jobA.id}/cancel`)
      .set('Cookie', [cookieB]);

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Forbidden');
    assert.equal(res.body.message, 'You are not authorized to cancel this email');
    assert.equal(res.body.email, undefined, 'Must not expose another user job details');

    // Verify job in database remains untouched in PENDING state
    const dbRecord = await EmailJobRepository.findById(jobA.id);
    assert.ok(dbRecord);
    assert.equal(dbRecord.status, 'PENDING');
  });

  it('should return 404 Not Found when attempting to cancel a nonexistent email ID', async () => {
    const fakeId = crypto.randomUUID();
    const res = await request(app)
      .post(`/api/emails/${fakeId}/cancel`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Not Found');
    assert.ok(res.body.message.includes('not found'));
  });

  it('should reject cancellation with 400 Bad Request if the email is already SENT', async () => {
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'already.sent@example.com',
      subject: 'Already Delivered Email',
      body: 'Delivered',
      sender: userA.email,
      scheduled_at: new Date(Date.now() - 10000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // Simulate completion
    await EmailJobRepository.markSent(job.id, { messageId: '<sent-msg-123@example.com>' });

    const res = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Invalid State');
    assert.equal(res.body.message, 'Cannot cancel an email that has already been sent');

    // State remains SENT
    const dbRecord = await EmailJobRepository.findById(job.id);
    assert.equal(dbRecord?.status, 'SENT');
  });

  it('should reject cancellation with 400 Bad Request if the email has already FAILED', async () => {
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'failed.candidate@example.com',
      subject: 'Failed Email',
      body: 'Failed',
      sender: userA.email,
      scheduled_at: new Date(Date.now() - 10000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // Mark as terminally failed
    await EmailJobRepository.markFailed(job.id, 'Permanent SMTP error', false);

    const res = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Invalid State');
    assert.equal(res.body.message, 'Cannot cancel an email that has already failed');

    const dbRecord = await EmailJobRepository.findById(job.id);
    assert.equal(dbRecord?.status, 'FAILED');
  });

  it('should reject cancellation with 400 Bad Request if the email is already CANCELLED', async () => {
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'double.cancel@example.com',
      subject: 'Already Cancelled',
      body: 'Content',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // Cancel once
    const firstRes = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);
    assert.equal(firstRes.status, 200);

    // Attempt second cancellation
    const secondRes = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);

    assert.equal(secondRes.status, 400);
    assert.equal(secondRes.body.success, false);
    assert.equal(secondRes.body.error, 'Invalid State');
    assert.equal(secondRes.body.message, 'Email has already been cancelled');
  });

  it('should reject cancellation with 409 Conflict if the email is currently being processed', async () => {
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'active.worker@example.com',
      subject: 'In Flight Email',
      body: 'Processing right now',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // Simulate worker acquiring the job
    const { canProcess } = await EmailJobRepository.markProcessing(job.id);
    assert.equal(canProcess, true);

    // Cancellation requested while in-flight
    const res = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Conflict');
    assert.equal(res.body.message, 'Cannot cancel an email that is currently being processed');

    // Status in DB remains PROCESSING
    const dbRecord = await EmailJobRepository.findById(job.id);
    assert.equal(dbRecord?.status, 'PROCESSING');
  });

  it('should exclude cancelled jobs from pending recovery and never re-enqueue them', async () => {
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'recovery.check@example.com',
      subject: 'Cancelled Not Recoverable',
      body: 'Should never recover',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // Cancel the job
    await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);

    // Check direct repository recovery method
    const pending = await EmailJobRepository.findPendingUnqueued(100, userA.id);
    assert.ok(
      !pending.some((p) => p.id === job.id),
      'Cancelled job must not be returned by findPendingUnqueued'
    );

    // Run recovery endpoint
    const recoveryRes = await request(app)
      .post('/api/emails/recover-pending')
      .set('Cookie', [cookieA]);

    assert.equal(recoveryRes.status, 200);
    if (recoveryRes.body.jobIds) {
      assert.ok(
        !recoveryRes.body.jobIds.includes(`email-job-${job.id}`),
        'Cancelled job must never be enqueued by recovery endpoint'
      );
    }
  });

  it('Worker/Cancellation Race: Worker must gracefully skip job when cancellation has committed', async () => {
    const job = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'race.worker@example.com',
      subject: 'Race Test Email',
      body: 'Worker picking up after cancel',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    createdJobIds.push(job.id);

    // 1. Cancel the job
    const cancelRes = await request(app)
      .post(`/api/emails/${job.id}/cancel`)
      .set('Cookie', [cookieA]);
    assert.equal(cancelRes.status, 200);

    // 2. Worker attempts to markProcessing
    const { canProcess, record } = await EmailJobRepository.markProcessing(job.id);

    // Worker must NOT be allowed to process
    assert.equal(canProcess, false);
    assert.equal(record?.status, 'CANCELLED');

    // Database record remains CANCELLED
    const refreshed = await EmailJobRepository.findById(job.id);
    assert.equal(refreshed?.status, 'CANCELLED');
  });
});
