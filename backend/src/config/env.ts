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
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // MySQL Database Configuration (Dedicated outbox_app Account)
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

  // Worker Concurrency & Throttling
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
