import { Request, Response } from 'express';
import { scheduleEmailSchema, listEmailsQuerySchema, searchEmailQuerySchema } from '../validation/emailSchemas';
import { EmailJobRepository } from '../database/repositories/emailJobRepository';
import { scheduleEmailJob } from '../queue/emailQueue';
import { RateLimiterService } from '../services/rateLimiterService';
import { ElasticsearchService } from '../services/elasticsearchService';
import { env } from '../config/env';

export class EmailController {
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
    const email = await EmailJobRepository.findById(id);
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
   * Lists emails with status filter and pagination.
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
   * Lists scheduled emails that are currently PENDING or PROCESSING.
   */
  public static async listScheduledEmails(req: Request, res: Response): Promise<void> {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const { total, emails } = await EmailJobRepository.findScheduled(limit, offset);

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
   * Lists completed emails that are either SENT or FAILED.
   */
  public static async listEmailHistory(req: Request, res: Response): Promise<void> {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const { total, emails } = await EmailJobRepository.findHistory(limit, offset);

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
      const searchResult = await ElasticsearchService.searchEmails(parseResult.data);
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
}
