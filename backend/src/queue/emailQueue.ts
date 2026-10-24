import { Queue, QueueOptions } from 'bullmq';
import { getRedisConfig, isRedisConfigured } from './redis';
import { EmailJobRecord } from '../database/models/emailJob';

export const EMAIL_QUEUE_NAME = 'email-jobs';

export interface EmailJobData {
  emailId: string;
  recipient: string;
  subject: string;
  sender: string;
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
  }
  return emailQueue;
}

/**
 * Enqueues a delayed BullMQ job using a deterministic job ID based on the MySQL email record ID.
 * Strictly uses BullMQ delayed jobs; no cron jobs or cron libraries are used.
 */
export async function scheduleEmailJob(record: EmailJobRecord): Promise<string> {
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

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}
