import fs from 'fs';
import path from 'path';
import { getDatabasePool, closeDatabasePool } from './mysql';

export async function runDatabaseMigrations(): Promise<void> {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[Database] Applying database migrations from schema.sql...');
  const pool = getDatabasePool();
  await pool.query(sql);
  console.log('[Database] Migrations applied successfully. Table `email_jobs` is verified.');
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
