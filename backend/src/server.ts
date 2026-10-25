import { createApp } from './app';
import { env } from './config/env';
import { closeDatabasePool } from './database/mysql';
import { closeRedisConnection, isRedisConfigured } from './queue/redis';
import { closeEmailQueue } from './queue/emailQueue';
import { initEmailWorker, closeEmailWorker } from './worker/emailWorker';

const app = createApp();

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Outbox Job Scheduler - Backend Service`);
  console.log(` Environment : ${env.NODE_ENV}`);
  console.log(` Host        : 0.0.0.0`);
  console.log(` Port        : ${env.PORT}`);
  console.log(` Health Check: http://localhost:${env.PORT}/health`);
  console.log(` API Router  : http://localhost:${env.PORT}/api`);
  console.log(` Emails API  : http://localhost:${env.PORT}/api/emails`);
  console.log(`===============================================`);

  if (env.START_WORKER && isRedisConfigured()) {
    console.log(`[Worker] Starting email worker (concurrency: ${env.WORKER_CONCURRENCY}, throttle: ${env.MIN_SEND_INTERVAL_MS}ms)...`);
    initEmailWorker();
  } else if (!env.START_WORKER) {
    console.log(`[Worker Notice] START_WORKER is false. Email worker not started in this process.`);
  } else {
    console.warn(`[Worker Notice] Redis not configured. Email worker not started.`);
  }
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('[Server] HTTP server closed.');

    try {
      if (env.START_WORKER) {
        console.log('[Server] Closing email worker...');
        await closeEmailWorker();
      }

      console.log('[Server] Closing email queue...');
      await closeEmailQueue();

      console.log('[Server] Closing Redis connection...');
      await closeRedisConnection();

      console.log('[Server] Closing Database connection pool...');
      await closeDatabasePool();

      console.log('[Server] Graceful shutdown completed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('[Server] Error during graceful shutdown:', err);
      process.exit(1);
    }
  });

  // Force close if graceful shutdown takes too long (e.g., 10 seconds)
  setTimeout(() => {
    console.error('[Server] Shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
