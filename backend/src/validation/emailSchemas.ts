import { z } from 'zod';

export const scheduleEmailSchema = z.object({
  recipient: z
    .string({ required_error: 'Recipient email is required' })
    .trim()
    .email({ message: 'Invalid recipient email address format' }),
  subject: z
    .string({ required_error: 'Subject is required' })
    .trim()
    .min(1, { message: 'Subject cannot be empty' })
    .max(255, { message: 'Subject exceeds 255 characters limit' }),
  body: z
    .string({ required_error: 'Body is required' })
    .min(1, { message: 'Body cannot be empty' }),
  scheduledAt: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        const parsed = new Date(val);
        return !isNaN(parsed.getTime());
      },
      { message: 'scheduledAt must be a valid ISO 8601 date string' }
    ),
  sender: z
    .string()
    .trim()
    .email({ message: 'Invalid sender email address format' })
    .optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional(),
  maxAttempts: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional(),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

export const listEmailsQuerySchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED']).optional(),
  recipient: z.string().trim().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0)),
});

export const searchEmailQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED']).optional(),
  sender: z.string().trim().optional(),
  recipient: z.string().trim().optional(),
  from: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        return !isNaN(new Date(val).getTime());
      },
      { message: "'from' must be a valid ISO 8601 date string" }
    ),
  to: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        return !isNaN(new Date(val).getTime());
      },
      { message: "'to' must be a valid ISO 8601 date string" }
    ),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10) || 1) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10) || 20)) : 20)),
  sortBy: z.enum(['scheduled_at', 'created_at', 'sent_at']).default('scheduled_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type SearchEmailQueryInput = z.infer<typeof searchEmailQuerySchema>;

export const parseLeadsSchema = z.object({
  content: z
    .string({ required_error: 'Content is required' })
    .min(1, { message: 'File or text content cannot be empty' }),
});

export type ParseLeadsInput = z.infer<typeof parseLeadsSchema>;

export const scheduleBatchSchema = z.object({
  recipients: z
    .array(
      z
        .string()
        .trim()
        .email({ message: 'Invalid recipient email format' })
    )
    .min(1, { message: 'At least one recipient email address is required' })
    .max(1000, { message: 'Maximum 1000 recipients per batch allowed' }),
  subject: z
    .string({ required_error: 'Subject is required' })
    .trim()
    .min(1, { message: 'Subject cannot be empty' })
    .max(255, { message: 'Subject exceeds 255 characters limit' }),
  body: z
    .string({ required_error: 'Body is required' })
    .min(1, { message: 'Body cannot be empty' }),
  sender: z
    .string()
    .trim()
    .email({ message: 'Invalid sender email address format' })
    .optional(),
  startTime: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        const parsed = new Date(val);
        return !isNaN(parsed.getTime());
      },
      { message: 'startTime must be a valid ISO 8601 date string' }
    ),
  delayBetweenEmailsSeconds: z
    .number()
    .int()
    .min(0, { message: 'Delay between emails cannot be negative' })
    .max(3600, { message: 'Delay between emails cannot exceed 3600 seconds (1 hour)' })
    .default(0),
  hourlyRateLimit: z
    .number()
    .int()
    .min(1, { message: 'hourlyRateLimit must be at least 1' })
    .max(1000, { message: 'hourlyRateLimit cannot exceed 1000' })
    .optional(),
  batchIdempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional(),
  maxAttempts: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional(),
});

export type ScheduleBatchInput = z.infer<typeof scheduleBatchSchema>;
