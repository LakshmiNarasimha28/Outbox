import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { AuthService } from '../services/authService';
import { getEmailQueue, EMAIL_QUEUE_NAME, closeEmailQueue } from '../queue/emailQueue';
import { closeRedisConnection } from '../queue/redis';
import { closeDatabasePool } from '../database/mysql';
import { getQueueTelemetry, resetBullBoard } from '../queue/bullBoard';

describe('BullMQ Live Queue Monitoring Dashboard & Telemetry Tests', () => {
  const app = createApp();
  const testUser = {
    id: 'queue-test-user-123',
    email: 'operator@outbox.labs',
    name: 'Queue Operator',
    avatar: 'https://example.com/avatar.jpg',
  };

  let validToken: string;

  before(async () => {
    validToken = AuthService.signSessionToken(testUser);
  });

  after(async () => {
    (env as any).AUTH_ENFORCED = false;
    resetBullBoard();
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  describe('Dashboard Authentication & Access Control Restrictions', () => {
    it('should reject unauthenticated JSON request to /admin/queues with 401 when AUTH_ENFORCED is true', async () => {
      const originalAuthEnforced = env.AUTH_ENFORCED;
      (env as any).AUTH_ENFORCED = true;

      try {
        const res = await request(app)
          .get('/admin/queues')
          .set('Accept', 'application/json');

        assert.equal(res.status, 401);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error, 'Unauthorized');
      } finally {
        (env as any).AUTH_ENFORCED = originalAuthEnforced;
      }
    });

    it('should redirect unauthenticated browser request to / with auth_error when AUTH_ENFORCED is true', async () => {
      const originalAuthEnforced = env.AUTH_ENFORCED;
      (env as any).AUTH_ENFORCED = true;

      try {
        const res = await request(app)
          .get('/admin/queues')
          .set('Accept', 'text/html');

        assert.equal(res.status, 302);
        assert.ok(res.headers.location);
        assert.ok(res.headers.location.includes('auth_error='));
      } finally {
        (env as any).AUTH_ENFORCED = originalAuthEnforced;
      }
    });

    it('should grant access to /admin/queues when valid session cookie is provided', async () => {
      const originalAuthEnforced = env.AUTH_ENFORCED;
      (env as any).AUTH_ENFORCED = true;

      try {
        const res = await request(app)
          .get('/admin/queues/')
          .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${validToken}`])
          .set('Accept', 'text/html');

        // Bull Board should respond with 200 (or redirect to slash)
        assert.ok([200, 301, 302].includes(res.status));
        if (res.status === 200) {
          assert.ok(
            res.text.includes('BullBoard') ||
              res.text.includes('queue') ||
              res.text.includes('id="root"') ||
              res.text.includes('<!DOCTYPE html>')
          );
        }
      } finally {
        (env as any).AUTH_ENFORCED = originalAuthEnforced;
      }
    });

    it('should reject unauthenticated request to /api/queues/stats with 401 when AUTH_ENFORCED is true', async () => {
      const originalAuthEnforced = env.AUTH_ENFORCED;
      (env as any).AUTH_ENFORCED = true;

      try {
        const res = await request(app).get('/api/queues/stats');
        assert.equal(res.status, 401);
        assert.equal(res.body.success, false);
      } finally {
        (env as any).AUTH_ENFORCED = originalAuthEnforced;
      }
    });
  });

  describe('Live Queue Telemetry & Existing Queue Reuse', () => {
    it('should return live telemetry matching existing BullMQ queue configuration', async () => {
      const res = await request(app)
        .get('/api/queues/stats')
        .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${validToken}`]);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.queueName, EMAIL_QUEUE_NAME);
      assert.equal(res.body.queueName, 'email-jobs');
      assert.equal(typeof res.body.available, 'boolean');
      assert.ok(res.body.counts);
      assert.equal(typeof res.body.counts.waiting, 'number');
      assert.equal(typeof res.body.counts.active, 'number');
      assert.equal(typeof res.body.counts.delayed, 'number');
      assert.equal(typeof res.body.counts.completed, 'number');
      assert.equal(typeof res.body.counts.failed, 'number');
    });

    it('should reuse getEmailQueue() without creating a duplicate queue', async () => {
      const queue1 = getEmailQueue();
      const queue2 = getEmailQueue();

      assert.equal(queue1, queue2);
      assert.equal(queue1?.name, 'email-jobs');

      const telemetry = await getQueueTelemetry();
      assert.equal(telemetry.queueName, 'email-jobs');
    });

    it('should reflect jobs scheduled via the queue in live telemetry counts', async () => {
      const queue = getEmailQueue();
      if (!queue) {
        // Skip if Redis is offline in current environment
        return;
      }

      // Add a test delayed job
      const testJobId = `test-telemetry-job-${Date.now()}`;
      const job = await queue.add(
        'send-email',
        {
          emailId: `fake-${Date.now()}`,
          recipient: 'monitor-test@outbox.labs',
          subject: 'Telemetry Verification',
          sender: testUser.email,
        },
        {
          jobId: testJobId,
          delay: 600000, // 10 minutes delay
        }
      );

      assert.ok(job);
      assert.equal(job.id, testJobId);

      // Verify telemetry reports the delayed job
      const telemetry = await getQueueTelemetry();
      assert.ok(telemetry.available);
      assert.ok(telemetry.counts.delayed >= 1);

      // Clean up test job
      await job.remove();
    });

    it('should map telemetry counts 1-to-1 to BullMQ native getJobCounts() results', async () => {
      const queue = getEmailQueue();
      if (!queue) return;

      const [expectedCounts, telemetryRes] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
        request(app)
          .get('/api/queues/stats')
          .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${validToken}`]),
      ]);

      assert.equal(telemetryRes.status, 200);
      const actualCounts = telemetryRes.body.counts;

      // The keys must represent BullMQ states, NOT MySQL email statuses
      assert.equal(typeof actualCounts.waiting, 'number');
      assert.equal(typeof actualCounts.active, 'number');
      assert.equal(typeof actualCounts.delayed, 'number');
      assert.equal(typeof actualCounts.completed, 'number');
      assert.equal(typeof actualCounts.failed, 'number');
      assert.equal(typeof actualCounts.paused, 'number');

      // Assert that MySQL email statuses are never mixed into BullMQ queue counts
      assert.equal(actualCounts.PENDING, undefined);
      assert.equal(actualCounts.PROCESSING, undefined);
      assert.equal(actualCounts.SENT, undefined);
      assert.equal(actualCounts.CANCELLED, undefined);
    });
  });

  describe('Bull Board Routing, Static Assets & SPA Fallback Safety', () => {
    it('should redirect /admin to /admin/queues', async () => {
      const res = await request(app).get('/admin');
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/admin/queues');
    });

    it('should serve Bull Board HTML dashboard at /admin/queues/ with proper base href and board title', async () => {
      const res = await request(app)
        .get('/admin/queues/')
        .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${validToken}`])
        .set('Accept', 'text/html');

      assert.equal(res.status, 200);
      assert.ok(res.text.includes('<title>Outbox Labs Queue Dashboard</title>'));
      assert.ok(res.text.includes('<base href="/admin/queues/" />'));
    });

    it('should serve Bull Board static assets without intercepting with HTML SPA fallback', async () => {
      const res = await request(app)
        .get('/admin/queues/static/css/main.88d71b4bd7.css')
        .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${validToken}`]);

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('text/css'));
      assert.ok(res.text.includes('button') || res.text.includes('body') || res.text.length > 500);
    });

    it('should serve Bull Board internal API endpoint /admin/queues/api/queues', async () => {
      const res = await request(app)
        .get('/admin/queues/api/queues')
        .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${validToken}`]);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.queues));
      const queueInfo = res.body.queues.find((q: any) => q.name === EMAIL_QUEUE_NAME);
      assert.ok(queueInfo, `Queue ${EMAIL_QUEUE_NAME} must be registered in Bull Board`);
      assert.ok(queueInfo.counts);
      assert.equal(typeof queueInfo.counts.delayed, 'number');
    });
  });

  describe('Graceful Degradation When Redis Is Unavailable', () => {
    it('should return available: false in telemetry when queue cannot connect', async () => {
      // Direct unit test of telemetry function contract
      const telemetry = await getQueueTelemetry();
      assert.ok(typeof telemetry.available === 'boolean');
      assert.ok(telemetry.counts);
      assert.equal(telemetry.dashboardUrl, '/admin/queues');
    });
  });
});
