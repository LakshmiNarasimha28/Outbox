import { checkDatabaseConnection, closeDatabasePool } from '../database/mysql';
import { checkRedisConnection, closeRedisConnection, getMaskedRedisEndpoint, isRedisConfigured } from '../queue/redis';
import { MailerService } from '../services/mailerService';
import { ElasticsearchService } from '../services/elasticsearchService';
import { env, loadedEnvFile } from '../config/env';

async function runVerification() {
  console.log(`============================================================`);
  console.log(` Outbox Labs Job Scheduler - Connection Verification Report`);
  console.log(` Timestamp : ${new Date().toISOString()}`);
  console.log(` Environment: ${env.NODE_ENV}`);
  console.log(` Config File: ${loadedEnvFile || 'None (using process environment variables)'}`);
  console.log(`============================================================\n`);

  const blockers: string[] = [];

  // --- 1. MySQL Connectivity Check ---
  console.log(`--- [1/3] MySQL Database Verification ---`);
  console.log(`Account  : ${env.DB_USER}`);
  console.log(`Host     : ${env.DB_HOST}:${env.DB_PORT}`);
  console.log(`Database : ${env.DB_NAME}`);
  console.log(`Password : ${env.DB_PASSWORD ? '[CONFIGURED - HIDDEN]' : '[NOT CONFIGURED / MISSING]'}`);

  const dbResult = await checkDatabaseConnection();
  if (dbResult.connected) {
    console.log(`Result   : [PASS] MySQL is reachable (latency: ${dbResult.latencyMs}ms)`);
  } else {
    console.log(`Result   : [FAIL] MySQL unreachable`);
    console.log(`Reason   : ${dbResult.error}`);
    blockers.push(`MySQL (${env.DB_USER}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}): ${dbResult.error}`);
  }
  await closeDatabasePool();

  console.log('');

  // --- 2. Redis Connectivity Check ---
  console.log(`--- [2/3] Hosted Redis / BullMQ Verification ---`);
  console.log(`Endpoint : ${getMaskedRedisEndpoint()}`);
  console.log(`Configured: ${isRedisConfigured() ? 'Yes' : 'No'}`);

  const redisResult = await checkRedisConnection();
  if (redisResult.connected) {
    console.log(`Result   : [PASS] Redis is reachable (latency: ${redisResult.latencyMs}ms)`);
  } else {
    console.log(`Result   : [FAIL] Redis unreachable`);
    console.log(`Reason   : ${redisResult.error}`);
    blockers.push(`Redis (${getMaskedRedisEndpoint()}): ${redisResult.error}`);
  }
  await closeRedisConnection();

  console.log('');

  // --- 3. Ethereal SMTP Mailer Check ---
  console.log(`--- [3/3] Ethereal SMTP Mailer Verification ---`);
  console.log(`Host     : ${env.SMTP_HOST}:${env.SMTP_PORT}`);
  console.log(`User     : ${env.SMTP_USER || '[NOT CONFIGURED]'}`);
  console.log(`Password : ${env.SMTP_PASS ? '[CONFIGURED - HIDDEN]' : '[NOT CONFIGURED / MISSING]'}`);

  if (!MailerService.isConfigured()) {
    console.log(`Result   : [NOTICE] Ethereal credentials missing. (Run 'npm run ethereal:create' to generate).`);
  } else {
    const startSmtp = Date.now();
    try {
      const transporter = MailerService.getTransporter();
      await transporter.verify();
      const latencySmtp = Date.now() - startSmtp;
      console.log(`Result   : [PASS] Ethereal SMTP is reachable & authenticated (latency: ${latencySmtp}ms)`);
    } catch (smtpErr) {
      const errMsg = smtpErr instanceof Error ? smtpErr.message : 'SMTP verification failed';
      console.log(`Result   : [FAIL] Ethereal SMTP verification failed`);
      console.log(`Reason   : ${errMsg}`);
      blockers.push(`Ethereal SMTP (${env.SMTP_HOST}:${env.SMTP_PORT}): ${errMsg}`);
    }
  }

  console.log('');

  // --- 4. Elasticsearch Verification ---
  console.log(`--- [4/4] Elasticsearch Search Cluster Verification ---`);
  console.log(`Endpoint : ${ElasticsearchService.getMaskedEndpoint()}`);
  console.log(`Index    : ${env.ELASTICSEARCH_INDEX}`);

  if (!ElasticsearchService.isConfigured()) {
    console.log(`Result   : [NOTICE] ELASTICSEARCH_NODE not configured. (Search endpoint is disabled until configured).`);
  } else {
    const esHealth = await ElasticsearchService.checkHealth();
    if (esHealth.connected) {
      console.log(`Result   : [PASS] Elasticsearch is reachable (cluster: ${esHealth.clusterName}, latency: ${esHealth.latencyMs}ms)`);
    } else {
      console.log(`Result   : [FAIL] Elasticsearch unreachable`);
      console.log(`Reason   : ${esHealth.error}`);
      blockers.push(`Elasticsearch (${ElasticsearchService.getMaskedEndpoint()}): ${esHealth.error}`);
    }
  }
  await ElasticsearchService.close();

  console.log('\n============================================================');
  if (blockers.length === 0) {
    console.log(`[STATUS: ALL CORE CONNECTIONS VERIFIED SUCCESSFULLY]`);
    console.log(`MySQL, Redis, and SMTP services are verified and operational.`);
    console.log(`============================================================`);
    process.exit(0);
  } else {
    console.log(`[STATUS: BLOCKERS DETECTED]`);
    console.log(`The following connections could not be verified:`);
    blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
    console.log(`============================================================`);
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('[Fatal Error during verification]', err instanceof Error ? err.message : err);
  process.exit(1);
});
