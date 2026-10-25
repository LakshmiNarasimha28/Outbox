import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

// Resolve possible paths for backend/.env to ensure it loads correctly regardless of CWD
const candidatePaths = [
  path.resolve(process.cwd(), 'backend', '.env'),
  path.resolve(__dirname, '../../.env'), // From src/config or dist/config to backend/.env
  path.resolve(process.cwd(), '.env'),
];

let resolvedEnvPath: string | null = null;
for (const cand of candidatePaths) {
  if (fs.existsSync(cand)) {
    dotenv.config({ path: cand });
    resolvedEnvPath = cand;
    break;
  }
}

// Fallback attempt in case environment variables are already set in process.env
if (!resolvedEnvPath) {
  dotenv.config();
}

export const loadedEnvFile = resolvedEnvPath;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'PORT must be a valid port number (1-65535)',
    }),
  FRONTEND_URL: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim().replace(/\/$/, '') : undefined)),
  APP_URL: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim().replace(/\/$/, '') : undefined)),
  CORS_ORIGIN: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim().length > 0) return val.trim().replace(/\/$/, '');
      const candidate = process.env.FRONTEND_URL || process.env.APP_URL;
      if (candidate && candidate.trim().length > 0) return candidate.trim().replace(/\/$/, '');
      return process.env.NODE_ENV === 'production'
        ? 'https://outbox-black.vercel.app'
        : 'http://localhost:5173';
    }),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      const num = parseInt(val, 10);
      return isNaN(num) ? val : num;
    }),

  // MySQL Database Configuration (Dedicated outbox_app Account or DATABASE_URL)
  DATABASE_URL: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z
    .string()
    .default('3306')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'DB_PORT must be a valid port number',
    }),
  DB_USER: z.string().default('outbox_app'),
  DB_PASSWORD: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val : undefined)),
  DB_NAME: z.string().default('outbox_scheduler'),
  DB_CONNECTION_LIMIT: z
    .string()
    .default('10')
    .transform((val) => parseInt(val, 10)),
  DB_SSL: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return val.toLowerCase() === 'true' || val === '1';
    }),
  DB_SSL_CA: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  DB_SSL_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return true;
      return val.toLowerCase() !== 'false' && val !== '0';
    }),

  // Redis / BullMQ Configuration (Hosted Redis instance)
  REDIS_URL: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  REDIS_HOST: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  REDIS_PORT: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? parseInt(val, 10) : undefined)),
  REDIS_PASSWORD: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val : undefined)),
  REDIS_USERNAME: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val : undefined)),
  REDIS_TLS: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return val.toLowerCase() === 'true' || val === '1';
    }),
  REDIS_DB: z
    .string()
    .default('0')
    .transform((val) => parseInt(val, 10)),

  // Ethereal SMTP Email Configuration
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z
    .string()
    .default('587')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val < 65536, {
      message: 'SMTP_PORT must be a valid port number',
    }),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  SMTP_USER: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  SMTP_PASS: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  DEFAULT_SENDER: z.string().default('scheduler@outbox.labs'),

  // Worker Concurrency, Throttling & Lifecycle
  START_WORKER: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return true;
      return val.toLowerCase() !== 'false' && val !== '0';
    }),
  WORKER_CONCURRENCY: z
    .string()
    .default('5')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 50, {
      message: 'WORKER_CONCURRENCY must be between 1 and 50',
    }),
  MIN_SEND_INTERVAL_MS: z
    .string()
    .default('200')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 0, {
      message: 'MIN_SEND_INTERVAL_MS must be a non-negative number',
    }),

  // Distributed Rate Limiting (Redis-backed atomic sliding window)
  HOURLY_RATE_LIMIT: z
    .string()
    .default('10')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 1, {
      message: 'HOURLY_RATE_LIMIT must be a positive integer',
    }),
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .default('3600000') // 1 hour in milliseconds
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 1000, {
      message: 'RATE_LIMIT_WINDOW_MS must be at least 1000 ms',
    }),

  // Elasticsearch Search & Indexing Configuration
  ELASTICSEARCH_NODE: z
    .string()
    .optional()
    .transform((val) => {
      const node = val || process.env.ELASTICSEARCH_URL;
      return node && node.trim().length > 0 ? node.trim() : undefined;
    }),
  ELASTICSEARCH_USERNAME: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  ELASTICSEARCH_PASSWORD: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val : undefined)),
  ELASTICSEARCH_API_KEY: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  ELASTICSEARCH_INDEX: z.string().default('email_jobs'),
  ELASTICSEARCH_REQUEST_TIMEOUT_MS: z
    .string()
    .default('5000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 1000, {
      message: 'ELASTICSEARCH_REQUEST_TIMEOUT_MS must be at least 1000 ms',
    }),

  // Google OAuth 2.0 & Session Configuration
  GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  GOOGLE_CALLBACK_URL: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim().length > 0) {
        const trimmed = val.trim();
        if (process.env.NODE_ENV === 'production' && (trimmed.includes('localhost') || trimmed.includes('127.0.0.1'))) {
          const frontend = process.env.FRONTEND_URL?.trim() || process.env.APP_URL?.trim() || 'https://outbox-black.vercel.app';
          return `${frontend.replace(/\/$/, '')}/api/auth/google/callback`;
        }
        return trimmed;
      }
      if (process.env.NODE_ENV === 'production') {
        const frontend = process.env.FRONTEND_URL?.trim() || process.env.APP_URL?.trim() || 'https://outbox-black.vercel.app';
        return `${frontend.replace(/\/$/, '')}/api/auth/google/callback`;
      }
      return 'http://localhost:5000/api/auth/google/callback';
    }),
  SESSION_SECRET: z
    .string()
    .default('outbox-super-secure-session-secret-change-in-prod'),
  AUTH_ENFORCED: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),

  // Slack OAuth v2 & Notification Configuration
  SLACK_CLIENT_ID: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  SLACK_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
  SLACK_CALLBACK_URL: z
    .string()
    .optional()
    .transform((val) => {
      if (val && val.trim().length > 0) {
        const trimmed = val.trim();
        if (process.env.NODE_ENV === 'production' && (trimmed.includes('localhost') || trimmed.includes('127.0.0.1'))) {
          const frontend = process.env.FRONTEND_URL?.trim() || process.env.APP_URL?.trim() || 'https://outbox-black.vercel.app';
          return `${frontend.replace(/\/$/, '')}/api/auth/slack/callback`;
        }
        return trimmed;
      }
      if (process.env.NODE_ENV === 'production') {
        const frontend = process.env.FRONTEND_URL?.trim() || process.env.APP_URL?.trim() || 'https://outbox-black.vercel.app';
        return `${frontend.replace(/\/$/, '')}/api/auth/slack/callback`;
      }
      return 'http://localhost:5000/api/auth/slack/callback';
    }),
  SLACK_NOTIFICATION_COOLDOWN_SECONDS: z
    .string()
    .default('900') // 15 minutes cooldown to avoid rate-limit spam
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val >= 10, {
      message: 'SLACK_NOTIFICATION_COOLDOWN_SECONDS must be at least 10 seconds',
    }),
  ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : undefined)),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    console.error(`[Configuration Error] Invalid environment variables: ${errorDetails}`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

/**
 * Resolves the user-facing frontend origin URL.
 * Prioritizes request headers from reverse proxy (Vercel proxy / x-forwarded-host),
 * then configured FRONTEND_URL / APP_URL / CORS_ORIGIN environment variables,
 * falling back to https://outbox-black.vercel.app in production or http://localhost:5173 in development.
 */
export function resolveFrontendUrl(req?: { get: (header: string) => string | undefined }): string {
  if (req) {
    const forwardedHost = req.get('x-forwarded-host');
    if (forwardedHost) {
      const cleanHost = forwardedHost.split(',')[0].trim();
      const proto = req.get('x-forwarded-proto') || 'https';
      // In production, do not treat backend onrender.com or accidental localhost headers as frontend
      if (
        !cleanHost.includes('onrender.com') &&
        (env.NODE_ENV !== 'production' || (!cleanHost.includes('localhost') && !cleanHost.includes('127.0.0.1')))
      ) {
        return `${proto}://${cleanHost}`.replace(/\/$/, '');
      }
    }
  }

  if (env.FRONTEND_URL) return env.FRONTEND_URL;
  if (env.APP_URL) return env.APP_URL;

  if (env.NODE_ENV === 'production') {
    if (
      env.CORS_ORIGIN &&
      !env.CORS_ORIGIN.includes('localhost') &&
      !env.CORS_ORIGIN.includes('127.0.0.1') &&
      !env.CORS_ORIGIN.includes('onrender.com')
    ) {
      return env.CORS_ORIGIN;
    }
    return 'https://outbox-black.vercel.app';
  }

  return env.CORS_ORIGIN || 'http://localhost:5173';
}

/**
 * Resolves the Google OAuth 2.0 callback URL sent to Google and exchanged for tokens.
 * In production, guarantees the authorized Vercel callback route is used
 * (https://outbox-black.vercel.app/api/auth/google/callback).
 * In development, uses the local backend callback route (http://localhost:5000/api/auth/google/callback).
 */
export function resolveGoogleCallbackUrl(req?: { get: (header: string) => string | undefined }): string {
  // If request arrived from a deployed origin (e.g. Vercel proxy with x-forwarded-host)
  if (req) {
    const forwardedHost = req.get('x-forwarded-host');
    if (forwardedHost) {
      const cleanHost = forwardedHost.split(',')[0].trim();
      if (!cleanHost.includes('onrender.com') && !cleanHost.includes('localhost') && !cleanHost.includes('127.0.0.1')) {
        const proto = req.get('x-forwarded-proto') || 'https';
        return `${proto}://${cleanHost}/api/auth/google/callback`;
      }
    }
  }

  const configured = process.env.GOOGLE_CALLBACK_URL?.trim();
  if (configured && configured.length > 0) {
    if (env.NODE_ENV === 'production' && (configured.includes('localhost') || configured.includes('127.0.0.1'))) {
      const base = resolveFrontendUrl(req);
      return `${base}/api/auth/google/callback`;
    }
    return configured;
  }

  if (env.NODE_ENV === 'production') {
    const base = resolveFrontendUrl(req);
    return `${base}/api/auth/google/callback`;
  }

  return `http://localhost:${env.PORT || 5000}/api/auth/google/callback`;
}
