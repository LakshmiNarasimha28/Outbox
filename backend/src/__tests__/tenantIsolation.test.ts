import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../app';
import { AuthService, AuthUser } from '../services/authService';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { getDatabasePool, closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

describe('Tenant Isolation Regression Tests', () => {
  const app = createApp();

  const userA: AuthUser = {
    id: `tenant-a-${Date.now()}`,
    email: 'user.a@tenant-a.com',
    name: 'User A',
    avatar: null,
  };
  const tokenA = AuthService.signSessionToken(userA);
  const cookieA = `${AuthService.SESSION_COOKIE_NAME}=${tokenA}`;

  const userB: AuthUser = {
    id: `tenant-b-${Date.now()}`,
    email: 'user.b@tenant-b.com',
    name: 'User B',
    avatar: null,
  };
  const tokenB = AuthService.signSessionToken(userB);
  const cookieB = `${AuthService.SESSION_COOKIE_NAME}=${tokenB}`;

  let jobAId: string;
  let jobBId: string;
  let legacyJobId: string;

  before(async () => {
    // 1. Create a job for User A
    const jobA = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'target.a@example.com',
      subject: 'User A Confidential Job',
      body: 'Content for tenant A only',
      sender: userA.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userA.id,
      user_email: userA.email,
    });
    jobAId = jobA.id;

    // 2. Create a job for User B
    const jobB = await EmailJobRepository.create({
      id: crypto.randomUUID(),
      recipient: 'target.b@example.com',
      subject: 'User B Confidential Job',
      body: 'Content for tenant B only',
      sender: userB.email,
      scheduled_at: new Date(Date.now() + 600000),
      user_id: userB.id,
      user_email: userB.email,
    });
    jobBId = jobB.id;

    // 3. Create an unassigned legacy job with user_id = NULL
    legacyJobId = crypto.randomUUID();
    const pool = getDatabasePool();
    await pool.query(
      `INSERT INTO email_jobs (id, recipient, subject, body, sender, scheduled_at, status, user_id, user_email)
       VALUES (?, 'legacy@example.com', 'Unassigned Legacy Record', 'Unassigned Body', 'system@outbox.labs', ?, 'PENDING', NULL, NULL)`,
      [legacyJobId, new Date(Date.now() + 600000)]
    );
  });

  after(async () => {
    // Clean up created fixtures
    const pool = getDatabasePool();
    await pool.query('DELETE FROM email_jobs WHERE id IN (?, ?, ?)', [jobAId, jobBId, legacyJobId]);

    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  it('GET /api/emails/:id - User A cannot retrieve User B email (returns 404)', async () => {
    const res = await request(app)
      .get(`/api/emails/${jobBId}`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes('not found'));
  });

  it('GET /api/emails/:id - User A cannot retrieve unassigned legacy email with user_id IS NULL (returns 404)', async () => {
    const res = await request(app)
      .get(`/api/emails/${legacyJobId}`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.ok(res.body.message.includes('not found'));
  });

  it('GET /api/emails/:id - User A CAN retrieve their own email', async () => {
    const res = await request(app)
      .get(`/api/emails/${jobAId}`)
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.email.id, jobAId);
    assert.equal(res.body.email.user_id, userA.id);
  });

  it('GET /api/emails/scheduled - User A list does not contain User B or unassigned legacy emails', async () => {
    const res = await request(app)
      .get('/api/emails/scheduled')
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const ids = res.body.emails.map((e: any) => e.id);

    assert.ok(ids.includes(jobAId), 'User A email should be present');
    assert.ok(!ids.includes(jobBId), 'User B email must NOT be present');
    assert.ok(!ids.includes(legacyJobId), 'Unassigned legacy email must NOT be present');
  });

  it('GET /api/emails/history - User A history does not contain User B or unassigned legacy emails', async () => {
    // Mark jobs as SENT to test history query
    const pool = getDatabasePool();
    await pool.query("UPDATE email_jobs SET status = 'SENT', sent_at = NOW(3) WHERE id IN (?, ?, ?)", [
      jobAId,
      jobBId,
      legacyJobId,
    ]);

    const res = await request(app)
      .get('/api/emails/history')
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const ids = res.body.emails.map((e: any) => e.id);

    assert.ok(ids.includes(jobAId), 'User A history email should be present');
    assert.ok(!ids.includes(jobBId), 'User B history email must NOT be present');
    assert.ok(!ids.includes(legacyJobId), 'Unassigned legacy history email must NOT be present');

    // Reset status back to PENDING for recovery tests
    await pool.query("UPDATE email_jobs SET status = 'PENDING', sent_at = NULL WHERE id IN (?, ?, ?)", [
      jobAId,
      jobBId,
      legacyJobId,
    ]);
  });

  it('GET /api/emails - General list strictly scopes to User A', async () => {
    const res = await request(app)
      .get('/api/emails')
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    const ids = res.body.emails.map((e: any) => e.id);

    assert.ok(ids.includes(jobAId), 'User A email should be present');
    assert.ok(!ids.includes(jobBId), 'User B email must NOT be present in User A list');
    assert.ok(!ids.includes(legacyJobId), 'Unassigned email must NOT be present in User A list');
  });

  it('POST /api/emails/recover-pending - User A recovery only enqueues User A jobs', async () => {
    const res = await request(app)
      .post('/api/emails/recover-pending')
      .set('Cookie', [cookieA]);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.jobIds));
    assert.ok(res.body.jobIds.includes(`email-job-${jobAId}`));
    assert.ok(!res.body.jobIds.includes(`email-job-${jobBId}`), 'User B job must not be recovered by User A');
    assert.ok(!res.body.jobIds.includes(`email-job-${legacyJobId}`), 'Legacy unassigned job must not be recovered by User A');
  });

  it('Direct Repository: findPendingUnqueued strictly enforces userId filter', async () => {
    const records = await EmailJobRepository.findPendingUnqueued(100, userA.id);
    const ids = records.map((r) => r.id);

    assert.ok(ids.includes(jobAId));
    assert.ok(!ids.includes(jobBId));
    assert.ok(!ids.includes(legacyJobId));
  });

  it('Direct Repository: findById strictly returns null for unassigned legacy record when userId is supplied', async () => {
    const record = await EmailJobRepository.findById(legacyJobId, userA.id);
    assert.equal(record, null);
  });
});
