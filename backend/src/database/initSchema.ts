import fs from 'fs';
import path from 'path';
import { getDatabasePool, closeDatabasePool } from './mysql';

const EMBEDDED_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS \`email_jobs\` (
  \`id\` VARCHAR(36) NOT NULL,
  \`recipient\` VARCHAR(255) NOT NULL,
  \`subject\` VARCHAR(255) NOT NULL,
  \`body\` MEDIUMTEXT NOT NULL,
  \`sender\` VARCHAR(255) NOT NULL DEFAULT 'scheduler@outbox.labs',
  \`scheduled_at\` DATETIME(3) NOT NULL,
  \`status\` ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  \`idempotency_key\` VARCHAR(255) DEFAULT NULL,
  \`attempts\` INT UNSIGNED NOT NULL DEFAULT 0,
  \`max_attempts\` INT UNSIGNED NOT NULL DEFAULT 3,
  \`last_attempt_at\` DATETIME(3) DEFAULT NULL,
  \`sent_at\` DATETIME(3) DEFAULT NULL,
  \`failed_at\` DATETIME(3) DEFAULT NULL,
  \`error_message\` TEXT DEFAULT NULL,
  \`ethereal_message_id\` VARCHAR(255) DEFAULT NULL,
  \`ethereal_preview_url\` TEXT DEFAULT NULL,
  \`user_id\` VARCHAR(255) DEFAULT NULL,
  \`user_email\` VARCHAR(255) DEFAULT NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_idempotency_key\` (\`idempotency_key\`),
  KEY \`idx_status_scheduled\` (\`status\`, \`scheduled_at\`),
  KEY \`idx_recipient\` (\`recipient\`),
  KEY \`idx_user_id\` (\`user_id\`),
  KEY \`idx_created_at\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`slack_integrations\` (
  \`id\` VARCHAR(36) NOT NULL,
  \`user_id\` VARCHAR(255) NOT NULL,
  \`user_email\` VARCHAR(255) DEFAULT NULL,
  \`sender\` VARCHAR(255) NOT NULL DEFAULT 'scheduler@outbox.labs',
  \`team_id\` VARCHAR(64) NOT NULL,
  \`team_name\` VARCHAR(255) NOT NULL,
  \`channel_id\` VARCHAR(64) DEFAULT NULL,
  \`channel_name\` VARCHAR(255) DEFAULT NULL,
  \`encrypted_access_token\` TEXT DEFAULT NULL,
  \`encrypted_webhook_url\` TEXT DEFAULT NULL,
  \`scope\` VARCHAR(255) DEFAULT NULL,
  \`bot_user_id\` VARCHAR(64) DEFAULT NULL,
  \`status\` ENUM('ACTIVE', 'REVOKED', 'DISCONNECTED') NOT NULL DEFAULT 'ACTIVE',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_user_slack\` (\`user_id\`),
  KEY \`idx_sender_status\` (\`sender\`, \`status\`),
  KEY \`idx_user_status\` (\`user_id\`, \`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

export function resolveSchemaSql(): { sql: string; source: string } {
  const candidatePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(__dirname, '../../src/database/schema.sql'),
    path.resolve(process.cwd(), 'src/database/schema.sql'),
    path.resolve(process.cwd(), 'backend/src/database/schema.sql'),
    path.resolve(process.cwd(), 'dist/database/schema.sql'),
    path.resolve(process.cwd(), 'backend/dist/database/schema.sql'),
  ];

  for (const cand of candidatePaths) {
    if (fs.existsSync(cand)) {
      return { sql: fs.readFileSync(cand, 'utf8'), source: cand };
    }
  }

  return { sql: EMBEDDED_SCHEMA_SQL, source: 'embedded_fallback' };
}

export async function runDatabaseMigrations(): Promise<void> {
  const { sql, source } = resolveSchemaSql();

  console.log(`[Database] Applying database migrations (source: ${source})...`);
  const pool = getDatabasePool();
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await pool.query(statement);
  }

  // Ensure user_id and user_email columns exist for OAuth user association
  try {
    await pool.query(`ALTER TABLE email_jobs ADD COLUMN user_id VARCHAR(255) DEFAULT NULL;`);
    console.log('[Database Migration] Added `user_id` column to `email_jobs`.');
  } catch (err: any) {
    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[Database Migration Notice]', err.message);
    }
  }

  try {
    await pool.query(`ALTER TABLE email_jobs ADD COLUMN user_email VARCHAR(255) DEFAULT NULL;`);
    console.log('[Database Migration] Added `user_email` column to `email_jobs`.');
  } catch (err: any) {
    if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') {
      console.warn('[Database Migration Notice]', err.message);
    }
  }

  try {
    await pool.query(`ALTER TABLE email_jobs ADD INDEX idx_user_id (user_id);`);
    console.log('[Database Migration] Added index `idx_user_id` to `email_jobs`.');
  } catch (err: any) {
    if (err.errno !== 1061 && err.code !== 'ER_DUP_KEYNAME') {
      console.warn('[Database Migration Notice]', err.message);
    }
  }

  // Ensure slack_integrations table exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS slack_integrations (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        user_email VARCHAR(255) DEFAULT NULL,
        sender VARCHAR(255) NOT NULL DEFAULT 'scheduler@outbox.labs',
        team_id VARCHAR(64) NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        channel_id VARCHAR(64) DEFAULT NULL,
        channel_name VARCHAR(255) DEFAULT NULL,
        encrypted_access_token TEXT DEFAULT NULL,
        encrypted_webhook_url TEXT DEFAULT NULL,
        scope VARCHAR(255) DEFAULT NULL,
        bot_user_id VARCHAR(64) DEFAULT NULL,
        status ENUM('ACTIVE', 'REVOKED', 'DISCONNECTED') NOT NULL DEFAULT 'ACTIVE',
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_user_slack (user_id),
        KEY idx_sender_status (sender, status),
        KEY idx_user_status (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('[Database Migration] Verified table `slack_integrations`.');
  } catch (err: any) {
    console.warn('[Database Migration Notice for slack_integrations]', err.message);
  }

  console.log('[Database] Migrations applied successfully. Tables `email_jobs` and `slack_integrations` verified.');
}

if (require.main === module) {
  runDatabaseMigrations()
    .then(async () => {
      await closeDatabasePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Database Migration Error]', err instanceof Error ? err.message : err);
      await closeDatabasePool();
      process.exit(1);
    });
}
