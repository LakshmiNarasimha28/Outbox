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
