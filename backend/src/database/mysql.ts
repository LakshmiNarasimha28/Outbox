import fs from 'fs';
import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import { env } from '../config/env';

export interface DatabaseHealthStatus {
  connected: boolean;
  latencyMs?: number;
  error?: string;
  database?: string;
  user?: string;
  host?: string;
  ssl?: boolean;
}

export interface DatabaseResolvedConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    rejectUnauthorized: boolean;
    ca?: string | Buffer;
  };
}

let pool: Pool | null = null;

/**
 * Resolves database configuration from discrete environment variables or DATABASE_URL,
 * securely applying TLS options without silently disabling verification by default.
 * Validates configuration and reports safe errors without exposing credentials.
 */
export function resolveDatabaseConfig(): DatabaseResolvedConfig {
  let host = env.DB_HOST;
  let port = env.DB_PORT;
  let user = env.DB_USER;
  let password = env.DB_PASSWORD || '';
  let database = env.DB_NAME;
  let useSsl = env.DB_SSL;

  const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mysqls:') {
        console.warn(`[Database Warning] DATABASE_URL protocol '${parsed.protocol}' is unexpected. Expected mysql: or mysqls:`);
      }
      if (parsed.hostname) host = parsed.hostname;
      if (parsed.port) port = parseInt(parsed.port, 10);
      if (parsed.username) user = decodeURIComponent(parsed.username);
      if (parsed.password) password = decodeURIComponent(parsed.password);
      if (parsed.pathname && parsed.pathname.length > 1) {
        database = decodeURIComponent(parsed.pathname.slice(1));
      }
      if (parsed.protocol === 'mysqls:' || parsed.searchParams.get('ssl') === 'true') {
        useSsl = true;
      }
    } catch (urlErr) {
      throw new Error(`Invalid DATABASE_URL configuration: ${urlErr instanceof Error ? urlErr.message : 'failed to parse URL'}`);
    }
  }

  let ssl: DatabaseResolvedConfig['ssl'] = undefined;
  if (useSsl) {
    ssl = {
      rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== false,
    };
    if (env.DB_SSL_CA) {
      if (fs.existsSync(env.DB_SSL_CA)) {
        ssl.ca = fs.readFileSync(env.DB_SSL_CA);
      } else if (env.DB_SSL_CA.includes('BEGIN CERTIFICATE')) {
        ssl.ca = env.DB_SSL_CA;
      } else {
        throw new Error('Configured DB_SSL_CA file path was not found and is not a valid PEM certificate string');
      }
    }
  }

  return { host, port, user, password, database, ssl };
}

export function getDatabasePool(): Pool {
  if (!pool) {
    const resolved = resolveDatabaseConfig();
    const config: PoolOptions = {
      host: resolved.host,
      port: resolved.port,
      user: resolved.user,
      password: resolved.password,
      database: resolved.database,
      ssl: resolved.ssl,
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
 * Sets a custom pool (used for testing/mocking).
 */
export function setDatabasePool(customPool: Pool | null): void {
  pool = customPool;
}

/**
 * Checks MySQL connectivity safely using the configured account.
 * Does not assume an empty password or root account.
 * Never throws or logs secrets.
 */
export async function checkDatabaseConnection(): Promise<DatabaseHealthStatus> {
  let resolved: DatabaseResolvedConfig;
  try {
    resolved = resolveDatabaseConfig();
  } catch (configErr) {
    return {
      connected: false,
      host: 'unknown',
      database: 'unknown',
      user: 'unknown',
      error: configErr instanceof Error ? configErr.message : 'Database configuration error',
    };
  }

  const hostInfo = `${resolved.host}:${resolved.port}`;

  if (!resolved.password) {
    return {
      connected: false,
      user: resolved.user,
      database: resolved.database,
      host: hostInfo,
      ssl: Boolean(resolved.ssl),
      error: 'DB_PASSWORD is not configured for database user in environment',
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
        user: resolved.user,
        database: resolved.database,
        host: hostInfo,
        ssl: Boolean(resolved.ssl),
      };
    } finally {
      connection.release();
    }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : 'Unknown database connection error';
    // Sanitize any potential credential traces
    const sanitized = rawMessage
      .replace(/password:?\s*\S+/gi, 'password: [REDACTED]')
      .replace(/([a-zA-Z0-9_-]+):([a-zA-Z0-9_\-~.+/%=]+)@/g, '$1:***@');
    return {
      connected: false,
      user: resolved.user,
      database: resolved.database,
      host: hostInfo,
      ssl: Boolean(resolved.ssl),
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
