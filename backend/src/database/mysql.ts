import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { env } from '../config/env';

export interface DatabaseHealthStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
  database?: string;
  user?: string;
  host?: string;
}

let pool: Pool | null = null;

export function getDatabasePool(): Pool {
  if (!pool) {
    const config: PoolOptions = {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME,
      waitForConnections: true,
      connectionLimit: env.DB_CONNECTION_LIMIT,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      connectTimeout: 5000,
    };

    pool = mysql.createPool(config);
  }
  return pool;
}

/**
 * Checks MySQL connectivity safely using the dedicated outbox_app account.
 * Does not assume an empty password or root account.
 * Never throws or logs secrets.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealthStatus> {
  const hostInfo = `${env.DB_HOST}:${env.DB_PORT}`;

  // Check if DB_PASSWORD is provided; do not assume empty password for outbox_app
  if (!env.DB_PASSWORD) {
    return {
      connected: false,
      user: env.DB_USER,
      database: env.DB_NAME,
      host: hostInfo,
      error: 'DB_PASSWORD is not configured for outbox_app in backend/.env',
    };
  }

  const start = Date.now();
  try {
    const currentPool = getDatabasePool();
    const connection = await currentPool.getConnection();
    try {
      await connection.query('SELECT 1 AS health');
      const latencyMs = Date.now() - start;
      return {
        connected: true,
        latencyMs,
        user: env.DB_USER,
        database: env.DB_NAME,
        host: hostInfo,
      };
    } finally {
      connection.release();
    }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown database connection error';
    // Sanitize any potential credential traces
    const sanitized = rawMessage.replace(/password:?\s*\S+/gi, 'password: [REDACTED]');
    return {
      connected: false,
      user: env.DB_USER,
      database: env.DB_NAME,
      host: hostInfo,
      error: sanitized,
    };
  }
}

/**
 * Gracefully shuts down the MySQL connection pool.
 */
export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      pool = null;
    } catch (err) {
      console.error('[Database] Error closing pool:', err instanceof Error ? err.message : err);
    }
  }
}
