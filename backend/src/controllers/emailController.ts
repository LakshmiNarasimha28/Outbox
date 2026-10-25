import { Request, Response } from 'express';
import {
  scheduleEmailSchema,
  listEmailsQuerySchema,
  searchEmailQuerySchema,
  parseLeadsSchema,
  scheduleBatchSchema,
} from '../validation/emailSchemas';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { scheduleEmailJob, scheduleEmailJobs, removeScheduledJob } from '../queue/emailQueue';
import { RateLimiterService } from '../services/rateLimiterService';
import { ElasticsearchService } from '../services/elasticsearchService';
import { parseLeads } from '../utils/leadParser';
import { env } from '../config/env';

export class EmailController {
  /**
   * Parses uploaded CSV or plain-text content into detected valid leads, duplicates, and invalid entries.
   */
  public static async parseLeads(req: Request, res: Response): Promise<void> {
    const parseResult = parseLeadsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const result = parseLeads(parseResult.data.content);
    res.status(200).json({
      success: true,
      ...result,
    });
  }

  /**
   * Schedules a batch of emails with configurable start time, configurable delay between emails,
   * per-lead idempotency, and distributed rate limiting.
   */
  /**
   * Schedules a batch of emails with configurable start time, configurable delay between emails,
   * per-lead idempotency, and distributed rate limiting.
   */
  public static async scheduleBatch(req: Request, res: Response): Promise<void> {
    const parseResult = scheduleBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const data = parseResult.data;
    const baseDate = data.startTime ? new Date(data.startTime) : new Date();
    const delayStepMs = data.delayBetweenEmailsSeconds * 1000;
    const batchKey = data.batchIdempotencyKey || crypto.randomUUID();

    // Deduplicate recipients within the batch upfront
    const seenRecipients = new Set<string>();
    const uniqueRecipients: string[] = [];
    for (const r of data.recipients) {
      const norm = r.trim().toLowerCase();
      if (!seenRecipients.has(norm)) {
        seenRecipients.add(norm);
        uniqueRecipients.push(norm);
      }
    }

    // Cache sender limit in Redis if provided
    if (data.hourlyRateLimit && data.sender) {
      await RateLimiterService.setSenderLimit(data.sender, data.hourlyRateLimit);
    }

    // Build creation inputs for all unique recipients
    const inputs = uniqueRecipients.map((recipient, index) => {
      const scheduledDate = new Date(baseDate.getTime() + index * delayStepMs);
      const idempotencyKey = `${batchKey}-${recipient}`;

      return {
        recipient,
        subject: data.subject,
        body: data.body,
        sender: data.sender || env.DEFAULT_SENDER,
        scheduled_at: scheduledDate,
        idempotency_key: idempotencyKey,
        max_attempts: data.maxAttempts ?? 3,
        user_id: req.user?.id || null,
        user_email: req.user?.email || null,
      };
    });

    // 1. Batch persist in MySQL with partial failure resilience
    const { created, existing, failed } = await EmailJobRepository.createMany(inputs);

    // 2. Synchronize newly created records to Elasticsearch search index (non-blocking)
    for (const record of created) {
      ElasticsearchService.indexEmail(record).catch(() => {});
    }

    // 3. Batch enqueue BullMQ delayed jobs
    // Enqueue newly created records + any existing records still in PENDING status (safe recovery on retry)
    const pendingToEnqueue = [
      ...created,
      ...existing.filter((e) => e.status === 'PENDING'),
    ];

    let jobIds: string[] = [];
    if (pendingToEnqueue.length > 0) {
      try {
        jobIds = await scheduleEmailJobs(pendingToEnqueue, {
          hourlyRateLimit: data.hourlyRateLimit,
        });
      } catch (queueErr) {
        const errMsg = queueErr instanceof Error ? queueErr.message : 'Failed to enqueue BullMQ batch';
        // Preserve records as PENDING in MySQL so they can be retried/recovered without duplicate emails
        for (const record of created) {
          await EmailJobRepository.updateErrorMessage(record.id, `Pending Queue Dispatch: ${errMsg}`);
        }
        res.status(503).json({
          success: false,
          error: 'Queue Dispatch Unavailable',
          message: 'Batch emails were persisted to database, but could not be enqueued in Redis. Records remain PENDING and can be retried or recovered without duplicate emails.',
          persistedCount: created.length,
          failedCount: failed.length,
        });
        return;
      }
    }

    const allRecords = [...created, ...existing];
    const firstScheduledAt = inputs.length > 0 ? inputs[0].scheduled_at : baseDate;
    const lastScheduledAt =
      inputs.length > 0 ? inputs[inputs.length - 1].scheduled_at : baseDate;

    res.status(201).json({
      success: true,
      message: `Batch schedule created: ${created.length} new jobs enqueued${existing.length > 0 ? `, ${existing.length} duplicate idempotency jobs skipped/reconciled` : ''}${failed.length > 0 ? `, ${failed.length} failed inserts` : ''}`,
      totalRequested: data.recipients.length,
      uniqueRecipientsCount: uniqueRecipients.length,
      scheduledCount: created.length,
      idempotentCount: existing.length,
      failedCount: failed.length,
      failedLeads: failed,
      delayBetweenEmailsSeconds: data.delayBetweenEmailsSeconds,
      hourlyRateLimit: data.hourlyRateLimit || env.HOURLY_RATE_LIMIT,
      firstScheduledAt: firstScheduledAt.toISOString(),
      lastScheduledAt: lastScheduledAt.toISOString(),
      jobIds,
      emails: allRecords,
    });
  }

  /**
   * Recovers any PENDING jobs from MySQL and enqueues them in BullMQ idempotently.
   * Scoped to the authenticated user if present.
   */
  public static async recoverPendingJobs(req: Request, res: Response): Promise<void> {
    const pending = await EmailJobRepository.findPendingUnqueued(200, req.user?.id);
    if (pending.length === 0) {
      res.status(200).json({
        success: true,
        message: 'No pending unqueued jobs found to recover',
        recoveredCount: 0,
        jobIds: [],
      });
      return;
    }

    try {
      const jobIds = await scheduleEmailJobs(pending);
      res.status(200).json({
        success: true,
        message: `Successfully recovered and enqueued ${pending.length} pending email jobs`,
        recoveredCount: pending.length,
        jobIds,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Recovery Dispatch Error',
        message: err instanceof Error ? err.message : 'Failed to recover pending jobs in Redis',
      });
    }
  }

  /**
   * Schedules an email. Validates input, persists to MySQL, and enqueues in BullMQ with delay.
   * Handles idempotency keys to prevent duplicate schedules.
   */
  public static async scheduleEmail(req: Request, res: Response): Promise<void> {
    const parseResult = scheduleEmailSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Validation Error',
        details: parseResult.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    const data = parseResult.data;

    // Idempotency Safeguard: Check if an email with this key was already submitted
    if (data.idempotencyKey) {
      const existing = await EmailJobRepository.findByIdempotencyKey(data.idempotencyKey);
      if (existing) {
        res.status(200).json({
          success: true,
          idempotent: true,
          message: 'Email job already exists with this idempotency key',
          email: existing,
        });
        return;
      }
    }

    // Determine target scheduled timestamp
    const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : new Date();

    // 1. Persist email record in MySQL before queueing
    const emailRecord = await EmailJobRepository.create({
      recipient: data.recipient,
      subject: data.subject,
      body: data.body,
      sender: data.sender,
      scheduled_at: scheduledDate,
      idempotency_key: data.idempotencyKey,
      max_attempts: data.maxAttempts ?? 3,
      user_id: req.user?.id || null,
      user_email: req.user?.email || null,
    });

    // 2. Synchronize to Elasticsearch search index (non-blocking safeguard: does not fail schedule on ES error)
    await ElasticsearchService.indexEmail(emailRecord);

    // 3. Enqueue BullMQ delayed job using deterministic job ID
    let jobId: string | null = null;
    try {
      jobId = await scheduleEmailJob(emailRecord);
    } catch (queueErr) {
      // Mark as failed in DB if queueing fails
      const errMsg = queueErr instanceof Error ? queueErr.message : 'Failed to enqueue BullMQ job';
      await EmailJobRepository.markFailed(emailRecord.id, errMsg, false);
      res.status(500).json({
        success: false,
        error: 'Queue Dispatch Error',
        message: 'Email was persisted to database but could not be enqueued in Redis queue',
        emailId: emailRecord.id,
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: 'Email scheduled successfully',
      jobId,
      email: emailRecord,
    });
  }

  /**
   * Retrieves an email record by ID.
   */
  public static async getEmailById(req: Request, res: Response): Promise<void> {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ success: false, error: 'Email ID parameter is required' });
      return;
    }
    const email = await EmailJobRepository.findById(id, req.user?.id);
    if (!email) {
      res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Email with ID '${id}' not found`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      email,
    });
  }

  /**
   * Lists emails with status filter, user scope, and pagination.
   */
  public static async listEmails(req: Request, res: Response): Promise<void> {
    const queryResult = listEmailsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid Query Parameters',
        details: queryResult.error.issues,
      });
      return;
    }

    const { status, recipient, limit, offset } = queryResult.data;
    const { total, emails } = await EmailJobRepository.findMany({
      status,
      recipient,
      limit,
      offset,
      userId: req.user?.id,
    });

    res.status(200).json({
      success: true,
      total,
      count: emails.length,
      limit,
      offset,
      emails,
    });
  }

  /**
   * Lists scheduled emails that are currently PENDING or PROCESSING, scoped by user.
   */
  public static async listScheduledEmails(req: Request, res: Response): Promise<void> {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const { total, emails } = await EmailJobRepository.findScheduled(limit, offset, req.user?.id);

    res.status(200).json({
      success: true,
      total,
      count: emails.length,
      limit,
      offset,
      emails,
    });
  }

  /**
   * Lists completed emails that are either SENT or FAILED, scoped by user.
   */
  public static async listEmailHistory(req: Request, res: Response): Promise<void> {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const { total, emails } = await EmailJobRepository.findHistory(limit, offset, req.user?.id);

    res.status(200).json({
      success: true,
      total,
      count: emails.length,
      limit,
      offset,
      emails,
    });
  }

  /**
   * Retrieves current rate limit quota and usage for a sender.
   */
  public static async getRateLimitStatus(req: Request, res: Response): Promise<void> {
    const sender = (req.query.sender as string) || env.DEFAULT_SENDER;
    try {
      const usage = await RateLimiterService.getUsage(sender);
      res.status(200).json({
        success: true,
        ...usage,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Rate Limiter Error',
        message: err instanceof Error ? err.message : 'Failed to query rate limit telemetry',
      });
    }
  }

  /**
   * Search email jobs across subject, body, recipient, sender, and filters via Elasticsearch.
   */
  public static async searchEmails(req: Request, res: Response): Promise<void> {
    const parseResult = searchEmailQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid Query Parameters',
        details: parseResult.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    if (!ElasticsearchService.isConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Service Unavailable',
        message: 'Elasticsearch is not configured. Set ELASTICSEARCH_NODE in backend/.env to enable search.',
      });
      return;
    }

    try {
      const searchResult = await ElasticsearchService.searchEmails({
        ...parseResult.data,
        userId: req.user?.id,
      });
      res.status(200).json({
        success: true,
        ...searchResult,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: 'Search Query Failed',
        message: err instanceof Error ? err.message : 'Unknown Elasticsearch error',
      });
    }
  }

  /**
   * Production-safe cancellation of a scheduled email by ID.
   * Enforces strict ownership, validates that the email is PENDING (not already PROCESSING, SENT, or FAILED),
   * coordinates MySQL atomic status transition with BullMQ job removal, and syncs Elasticsearch.
   */
  public static async cancelScheduledEmail(req: Request, res: Response): Promise<void> {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ success: false, error: 'Email ID parameter is required' });
      return;
    }

    try {
      const result = await EmailJobRepository.cancelJob(id, req.user?.id);

      if (!result.success) {
        switch (result.reason) {
          case 'NOT_FOUND':
            res.status(404).json({
              success: false,
              error: 'Not Found',
              message: `Email with ID '${id}' not found`,
            });
            return;

          case 'UNAUTHORIZED':
            res.status(403).json({
              success: false,
              error: 'Forbidden',
              message: 'You are not authorized to cancel this email',
            });
            return;

          case 'ALREADY_SENT':
            res.status(400).json({
              success: false,
              error: 'Invalid State',
              message: 'Cannot cancel an email that has already been sent',
            });
            return;

          case 'ALREADY_FAILED':
            res.status(400).json({
              success: false,
              error: 'Invalid State',
              message: 'Cannot cancel an email that has already failed',
            });
            return;

          case 'ALREADY_PROCESSING':
            res.status(409).json({
              success: false,
              error: 'Conflict',
              message: 'Cannot cancel an email that is currently being processed',
            });
            return;

          case 'ALREADY_CANCELLED':
            res.status(400).json({
              success: false,
              error: 'Invalid State',
              message: 'Email has already been cancelled',
            });
            return;

          default:
            res.status(400).json({
              success: false,
              error: 'Invalid State',
              message: 'Email cannot be cancelled in its current state',
            });
            return;
        }
      }

      // 2. Remove the delayed job from BullMQ queue
      await removeScheduledJob(id);

      // 3. Sync CANCELLED state to Elasticsearch
      await ElasticsearchService.updateEmail(id, {
        status: 'CANCELLED',
        error_message: 'Cancelled by user',
      });

      res.status(200).json({
        success: true,
        message: 'Email scheduled job cancelled successfully',
        email: result.record,
      });
    } catch (err: any) {
      console.error(`[EmailController] Error cancelling email ${id}:`, err);
      res.status(500).json({
        success: false,
        error: 'Cancellation Failed',
        message: err instanceof Error ? err.message : 'Unknown cancellation error',
      });
    }
  }
}
