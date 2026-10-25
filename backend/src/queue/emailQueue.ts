import { Queue, QueueOptions } from 'bullmq';
import { getRedisConfig, isRedisConfigured } from './redis';
import { EmailJobRecord } from '../database/models/emailJob';

export const EMAIL_QUEUE_NAME = 'email-jobs';

export interface EmailJobData {
  emailId: string;
  recipient: string;
  subject: string;
  sender: string;
  hourlyRateLimit?: number;
}

let emailQueue: Queue<EmailJobData> | null = null;

export function getEmailQueue(): Queue<EmailJobData> | null {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!emailQueue) {
    const queueOptions: QueueOptions = {
      connection: getRedisConfig(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    };

    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, queueOptions);
    emailQueue.on('error', (err) => {
      console.warn(`[BullMQ Queue Notice] ${err.message}`);
    });
  }
  return emailQueue;
}

/**
 * Enqueues a delayed BullMQ job using a deterministic job ID based on the MySQL email record ID.
 * Strictly uses BullMQ delayed jobs; no cron jobs or cron libraries are used.
 */
export async function scheduleEmailJob(
  record: EmailJobRecord,
  options?: { hourlyRateLimit?: number }
): Promise<string> {
  const queue = getEmailQueue();
  if (!queue) {
    throw new Error('Redis queue is not configured. Check REDIS_URL or REDIS_HOST in backend/.env');
  }

  const scheduledTime = new Date(record.scheduled_at).getTime();
  const delay = Math.max(0, scheduledTime - Date.now());

  // Deterministic Job ID ensures exactly one BullMQ job per database email record
  const jobId = `email-job-${record.id}`;

  const job = await queue.add(
    'send-email',
    {
      emailId: record.id,
      recipient: record.recipient,
      subject: record.subject,
      sender: record.sender,
      hourlyRateLimit: options?.hourlyRateLimit,
    },
    {
      jobId,
      delay,
      attempts: record.max_attempts || 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }
  );

  return job.id || jobId;
}

/**
 * Enqueues a batch of delayed BullMQ jobs using BullMQ's native addBulk API.
 * Preserves deterministic job IDs, calculated delays, and custom hourly rate limits.
 */
export async function scheduleEmailJobs(
  records: EmailJobRecord[],
  options?: { hourlyRateLimit?: number }
): Promise<string[]> {
  if (records.length === 0) return [];

  const queue = getEmailQueue();
  if (!queue) {
    throw new Error('Redis queue is not configured. Check REDIS_URL or REDIS_HOST in backend/.env');
  }

  const now = Date.now();
  const bulkJobs = records.map((record) => {
    const scheduledTime = new Date(record.scheduled_at).getTime();
    const delay = Math.max(0, scheduledTime - now);
    const jobId = `email-job-${record.id}`;

    return {
      name: 'send-email',
      data: {
        emailId: record.id,
        recipient: record.recipient,
        subject: record.subject,
        sender: record.sender,
        hourlyRateLimit: options?.hourlyRateLimit,
      },
      opts: {
        jobId,
        delay,
        attempts: record.max_attempts || 3,
        backoff: {
          type: 'exponential' as const,
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    };
  });

  const jobs = await queue.addBulk(bulkJobs);
  return jobs.map((job, idx) => job.id || bulkJobs[idx].opts.jobId);
}

/**
 * Removes a scheduled delayed or waiting job from the BullMQ queue by email record ID.
 * Safely handles missing jobs, already-active jobs, or Redis downtime.
 */
export async function removeScheduledJob(
  emailId: string
): Promise<{ removed: boolean; state?: string }> {
  const queue = getEmailQueue();
  if (!queue) {
    return { removed: false };
  }
  const jobId = `email-job-${emailId}`;
  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return { removed: false, state: 'not_found' };
    }
    const state = await job.getState();
    // Only remove if it is not currently active/running in worker
    if (state === 'delayed' || state === 'waiting') {
      await job.remove();
      return { removed: true, state };
    }
    return { removed: false, state };
  } catch (err: any) {
    console.warn(`[BullMQ] Notice removing job for email ${emailId}: ${err?.message}`);
    return { removed: false, state: 'error' };
  }
}

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    try {
      await emailQueue.waitUntilReady();
    } catch {
      // Ignore if queue was not connected or failed to connect
    }
    try {
      await emailQueue.close();
    } catch (err: any) {
      console.warn(`[BullMQ Notice] Queue close: ${err?.message}`);
    }
    emailQueue = null;
  }
}
