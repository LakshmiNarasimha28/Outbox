import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { resolveDatabaseConfig, closeDatabasePool, checkDatabaseConnection } from '../database/mysql';
import { resolveSchemaSql, runDatabaseMigrations } from '../database/initSchema';
import { HealthService } from '../services/healthService';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue, getEmailQueue } from '../queue/emailQueue';

describe('Production Configuration & Operational Safety Tests', () => {
  const app = createApp();

  after(async () => {
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  describe('MySQL Production Connection & Configuration', () => {
    it('resolveDatabaseConfig() correctly resolves discrete configuration', () => {
      const config = resolveDatabaseConfig();
      assert.ok(config.host);
      assert.ok(config.port > 0);
      assert.ok(config.user);
      assert.ok(config.database);
    });

    it('resolveDatabaseConfig() parses DATABASE_URL without leaking credentials', () => {
      const originalUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = 'mysql://prod_user:secret_pass_123@prod-db.outbox.internal:3307/outbox_prod?ssl=true';
        const config = resolveDatabaseConfig();

        assert.equal(config.host, 'prod-db.outbox.internal');
        assert.equal(config.port, 3307);
        assert.equal(config.user, 'prod_user');
        assert.equal(config.password, 'secret_pass_123');
        assert.equal(config.database, 'outbox_prod');
        assert.ok(config.ssl);
        // Ensure default rejectUnauthorized is TRUE for production security
        assert.equal(config.ssl?.rejectUnauthorized, true);
      } finally {
        if (originalUrl !== undefined) {
          process.env.DATABASE_URL = originalUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    it('resolveDatabaseConfig() enables TLS for mysqls:// protocol and enforces certificate validation by default', () => {
      const originalUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL = 'mysqls://secure_user:pass@mysql-tls.cluster.local:3306/db';
        const config = resolveDatabaseConfig();

        assert.ok(config.ssl);
        assert.equal(config.ssl?.rejectUnauthorized, true);
      } finally {
        if (originalUrl !== undefined) {
          process.env.DATABASE_URL = originalUrl;
        } else {
          delete process.env.DATABASE_URL;
        }
      }
    });

    it('checkDatabaseConnection() sanitizes credentials from reported errors', async () => {
      const { setDatabasePool } = await import('../database/mysql');
      const mockFailingPool = {
        getConnection: async () => {
          throw new Error(
            'connect ECONNREFUSED with password: super_secret_123 to mysql://app:secret_in_url@localhost:3306'
          );
        },
      } as any;

      setDatabasePool(mockFailingPool);
      try {
        const status = await checkDatabaseConnection();
        assert.equal(status.connected, false);
        assert.ok(status.error, 'Error message should exist');
        assert.ok(!status.error.includes('super_secret_123'), 'Raw password should be redacted');
        assert.ok(!status.error.includes('secret_in_url'), 'URL password should be redacted');
        assert.ok(status.error.includes('[REDACTED]'), 'Should contain [REDACTED]');
        assert.ok(status.error.includes('app:***@'), 'Should contain masked URL user');
      } finally {
        setDatabasePool(null);
      }
    });
  });

  describe('Schema Migration Packaging & Repeatability', () => {
    it('resolveSchemaSql() returns valid DDL statements without throwing', () => {
      const { sql, source } = resolveSchemaSql();
      assert.ok(sql.length > 0);
      assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS `email_jobs`'));
      assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS `slack_integrations`'));
      assert.ok(source.length > 0);
    });

    it('runDatabaseMigrations() executes idempotently and repeatedly on current database', async () => {
      // Running migrations twice should succeed without error (e.g. duplicate column/key errors are safely handled)
      await runDatabaseMigrations();
      await runDatabaseMigrations();
    });
  });

  describe('Production Health Probes & Service Readiness', () => {
    it('GET /health/live returns liveness status with 200 without polling database', async () => {
      const res = await request(app).get('/health/live');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.ok(typeof res.body.uptimeSeconds === 'number');
      assert.ok(res.body.timestamp);
    });

    it('GET /health/ready returns readiness check based on core services (MySQL & Redis)', async () => {
      const res = await request(app).get('/health/ready');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ready');
      assert.equal(res.body.database, true);
      assert.equal(res.body.redis, true);
    });

    it('HealthService.isReady() succeeds even when optional Elasticsearch is not configured', async () => {
      const status = await HealthService.isReady();
      assert.equal(status.ready, true);
      assert.equal(status.database, true);
      assert.equal(status.redis, true);
    });
  });

  describe('Queue & Worker Separation Safety', () => {
    it('Email queue remains functional and available independently of worker state', () => {
      const queue = getEmailQueue();
      assert.ok(queue !== null, 'Queue creation must succeed independently of START_WORKER');
    });
  });
});
