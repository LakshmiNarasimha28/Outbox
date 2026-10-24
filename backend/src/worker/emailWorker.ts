import { Worker, Job, DelayedError } from 'bullmq';
import { getRedisConfig, isRedisConfigured } from '../queue/redis';
import { EMAIL_QUEUE_NAME, EmailJobData, getEmailQueue } from '../queue/emailQueue';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { MailerService } from '../services/mailerService';
import { RateLimiterService } from '../services/rateLimiterService';
import { ElasticsearchService } from '../services/elasticsearchService';
import { env } from '../config/env';

let emailWorker: Worker<EmailJobData> | null = null;
let lastSendTimestamp = 0;

/**
 * Throttles send execution to ensure the configurable minimum send interval is respected.
 */
async function enforceMinimumSendInterval(intervalMs: number): Promise<void> {
  if (intervalMs <= 0) return;
  const now = Date.now();
  const elapsed = now - lastSendTimestamp;
  if (elapsed < intervalMs) {
    const delay = intervalMs - elapsed;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  lastSendTimestamp = Date.now();
}

/**
 * Masks an email recipient address for safe logging without revealing sensitive data.
 * e.g., "candidate@example.com" -> "c***e@example.com"
 */
function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  if (name.length <= 2) return `*@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

export function initEmailWorker(): Worker<EmailJobData> | null {
  if (!isRedisConfigured()) {
    return null;
  }

  if (emailWorker) {
    return emailWorker;
  }

  emailWorker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>, token?: string) => {
      const { emailId } = job.data;
      const masked = maskEmail(job.data.recipient);
      console.log(`[Worker] Picked up job ${job.id} for email: ${emailId} (${masked})`);

      // 1. Duplicate-Processing Safeguard: Check database status
      const { canProcess, record } = await EmailJobRepository.markProcessing(emailId);
      if (!canProcess || !record) {
        console.warn(
          `[Worker] Skipping email ${emailId}: status is '${record?.status || 'NOT_FOUND'}'.`
        );
        return { skipped: true, reason: record?.status || 'NOT_FOUND' };
      }

      // Sync state transition to Elasticsearch index
      await ElasticsearchService.updateEmail(emailId, {
        status: 'PROCESSING',
        last_attempt_at: new Date(),
        attempts: record.attempts,
      });

      // 2. Distributed Hourly Rate-Limiting Check (Redis-backed atomic sliding window)
      // Throws RateLimiterError if Redis is unavailable to avoid silently bypassing the limit.
      const rateLimit = await RateLimiterService.checkAndConsume(record.sender);
      if (!rateLimit.allowed) {
        const nextEligibleTime = Date.now() + Math.max(rateLimit.retryAfterMs, 1000);
        const nextDate = new Date(nextEligibleTime);
        const reason = `Hourly limit of ${rateLimit.limit} reached for ${record.sender}. Rescheduled for ${nextDate.toISOString()}`;
        console.warn(
          `[Worker] ${reason}. Delaying job ${job.id} by ${rateLimit.retryAfterMs}ms.`
        );

        // Update database: status back to PENDING, scheduled_at updated, attempts decremented
        await EmailJobRepository.rescheduleForRateLimit(emailId, nextDate, reason);

        // Sync rescheduled state to Elasticsearch
        await ElasticsearchService.updateEmail(emailId, {
          status: 'PENDING',
          scheduled_at: nextDate,
          error_message: reason,
          attempts: Math.max(0, record.attempts - 1),
        });

        // Reschedule in BullMQ delayed storage
        if (token) {
          await job.moveToDelayed(nextEligibleTime, token);
          throw new DelayedError();
        } else {
          const queue = getEmailQueue();
          if (queue) {
            await queue.add('send-email', job.data, {
              delay: Math.max(1000, rateLimit.retryAfterMs),
              attempts: record.max_attempts,
            });
          }
          return { rescheduled: true, nextEligibleTime: nextDate.toISOString() };
        }
      }

      // 3. Minimum send interval throttle
      await enforceMinimumSendInterval(env.MIN_SEND_INTERVAL_MS);

      // 4. Ethereal SMTP Credential Verification
      if (!MailerService.isConfigured()) {
        // Refund rate limit token since transmission was aborted due to config
        if (rateLimit.memberId) {
          await RateLimiterService.refund(record.sender, rateLimit.memberId);
        }
        const errorMsg =
          'Ethereal SMTP credentials not configured. Please define SMTP_USER and SMTP_PASS in backend/.env.';
        console.error(`[Worker] Delivery blocked for ${emailId}: ${errorMsg}`);
        await EmailJobRepository.markFailed(emailId, errorMsg, false);
        await ElasticsearchService.updateEmail(emailId, {
          status: 'FAILED',
          failed_at: new Date(),
          error_message: errorMsg,
        });
        throw new Error(errorMsg);
      }

      // 5. Dispatch Email via Nodemailer
      try {
        const sendResult = await MailerService.sendMail({
          to: record.recipient,
          subject: record.subject,
          body: record.body,
          from: record.sender,
        });

        // 6. Update Database as SENT
        await EmailJobRepository.markSent(emailId, {
          messageId: sendResult.messageId,
          previewUrl: sendResult.previewUrl,
        });

        // Sync SENT state to Elasticsearch
        await ElasticsearchService.updateEmail(emailId, {
          status: 'SENT',
          sent_at: new Date(),
          ethereal_message_id: sendResult.messageId,
          ethereal_preview_url: sendResult.previewUrl,
          error_message: null,
        });

        console.log(`[Worker] Email ${emailId} sent successfully! MessageId: ${sendResult.messageId}`);
        if (sendResult.previewUrl) {
          console.log(`[Worker] Ethereal Preview URL: ${sendResult.previewUrl}`);
        }

        return {
          success: true,
          emailId,
          messageId: sendResult.messageId,
          previewUrl: sendResult.previewUrl,
        };
      } catch (err) {
        // Refund the rate limit token so sender is not penalized for infrastructure transmission failures
        if (rateLimit.memberId) {
          await RateLimiterService.refund(record.sender, rateLimit.memberId);
        }

        const rawMsg = err instanceof Error ? err.message : 'Unknown mailer error';
        const sanitizedMsg = rawMsg.replace(/password:?\s*\S+/gi, 'password: [REDACTED]');
        console.error(`[Worker] Error sending email ${emailId}: ${sanitizedMsg}`);

        // Check retry threshold
        const willRetry = record.attempts < record.max_attempts;
        await EmailJobRepository.markFailed(emailId, sanitizedMsg, willRetry);

        // Sync FAILED / RETRY state to Elasticsearch
        await ElasticsearchService.updateEmail(emailId, {
          status: willRetry ? 'PENDING' : 'FAILED',
          failed_at: willRetry ? undefined : new Date(),
          error_message: sanitizedMsg,
          attempts: record.attempts,
        });

        // Re-throw so BullMQ registers the failure and schedules exponential backoff
        throw new Error(sanitizedMsg);
      }
    },
    {
      connection: getRedisConfig(),
      concurrency: env.WORKER_CONCURRENCY,
      autorun: true,
    }
  );

  emailWorker.on('completed', (job: Job<EmailJobData>) => {
    console.log(`[Worker] Job ${job.id} completed.`);
  });

  emailWorker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
    console.error(`[Worker] Job ${job?.id ?? 'unknown'} failed: ${err.message}`);
  });

  emailWorker.on('error', (err: Error) => {
    console.warn(`[Worker Notice] Worker issue: ${err.message}`);
  });

  return emailWorker;
}

export async function closeEmailWorker(): Promise<void> {
  if (emailWorker) {
    await emailWorker.close();
    emailWorker = null;
  }
}
