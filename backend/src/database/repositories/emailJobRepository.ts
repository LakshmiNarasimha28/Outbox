import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import crypto from 'crypto';
import { getDatabasePool } from '../mysql';
import { EmailJobRecord, CreateEmailJobInput, EmailStatus } from '../models/emailJob';

type EmailJobRow = EmailJobRecord & RowDataPacket;

export class EmailJobRepository {
  /**
   * Persists a new email job record in MySQL.
   */
  public static async create(input: CreateEmailJobInput): Promise<EmailJobRecord> {
    const pool = getDatabasePool();
    const id = input.id || crypto.randomUUID();
    const maxAttempts = input.max_attempts ?? 3;
    const sender = input.sender || 'scheduler@outbox.labs';
    const idempotencyKey = input.idempotency_key || null;
    const userId = input.user_id || null;
    const userEmail = input.user_email || null;

    const query = `
      INSERT INTO email_jobs (
        id, recipient, subject, body, sender, scheduled_at,
        status, idempotency_key, attempts, max_attempts, user_id, user_email
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, ?)
    `;

    try {
      await pool.query<ResultSetHeader>(query, [
        id,
        input.recipient,
        input.subject,
        input.body,
        sender,
        input.scheduled_at,
        idempotencyKey,
        maxAttempts,
        userId,
        userEmail,
      ]);
    } catch (err: any) {
      if ((err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) && idempotencyKey) {
        const existing = await this.findByIdempotencyKey(idempotencyKey);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }

    const created = await this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve newly created email job with ID: ${id}`);
    }
    return created;
  }

  /**
   * Persists a batch of email jobs in MySQL.
   * Handles partial failures so that one faulty lead does not abort the entire batch.
   * Gracefully returns created, existing (idempotent hits), and failed records.
   */
  public static async createMany(
    inputs: CreateEmailJobInput[]
  ): Promise<{
    created: EmailJobRecord[];
    existing: EmailJobRecord[];
    failed: { recipient: string; error: string }[];
  }> {
    const created: EmailJobRecord[] = [];
    const existing: EmailJobRecord[] = [];
    const failed: { recipient: string; error: string }[] = [];

    for (const input of inputs) {
      try {
        const generatedId = input.id || crypto.randomUUID();
        const record = await this.create({ ...input, id: generatedId });
        if (record.id !== generatedId) {
          existing.push(record);
        } else {
          created.push(record);
        }
      } catch (err: any) {
        failed.push({
          recipient: input.recipient,
          error: err?.message || 'Database insert failed',
        });
      }
    }

    return { created, existing, failed };
  }

  /**
   * Updates error message on an email job without changing its PENDING status.
   */
  public static async updateErrorMessage(id: string, errorMessage: string): Promise<void> {
    const pool = getDatabasePool();
    await pool.query('UPDATE email_jobs SET error_message = ? WHERE id = ?', [errorMessage, id]);
  }

  /**
   * Retrieves pending email jobs for queue recovery.
   */
  public static async findPendingUnqueued(limit = 100): Promise<EmailJobRecord[]> {
    const pool = getDatabasePool();
    const query = `
      SELECT * FROM email_jobs
      WHERE status = 'PENDING'
      ORDER BY scheduled_at ASC
      LIMIT ?
    `;
    const [rows] = await pool.query<EmailJobRow[]>(query, [limit]);
    return rows;
  }

  /**
   * Finds an email job by primary key ID, optionally verifying user ownership.
   */
  public static async findById(id: string, userId?: string): Promise<EmailJobRecord | null> {
    const pool = getDatabasePool();
    let query = `SELECT * FROM email_jobs WHERE id = ?`;
    const params: any[] = [id];
    if (userId) {
      query += ` AND (user_id = ? OR user_id IS NULL)`;
      params.push(userId);
    }
    query += ` LIMIT 1`;
    const [rows] = await pool.query<EmailJobRow[]>(query, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Finds an email job by its unique idempotency key.
   */
  public static async findByIdempotencyKey(key: string): Promise<EmailJobRecord | null> {
    const pool = getDatabasePool();
    const query = `SELECT * FROM email_jobs WHERE idempotency_key = ? LIMIT 1`;
    const [rows] = await pool.query<EmailJobRow[]>(query, [key]);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Lists email jobs with optional filtering by status, recipient, userId, and pagination.
   */
  public static async findMany(filters: {
    status?: EmailStatus;
    recipient?: string;
    limit?: number;
    offset?: number;
    userId?: string;
  }): Promise<{ total: number; emails: EmailJobRecord[] }> {
    const pool = getDatabasePool();
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.recipient) {
      conditions.push('recipient = ?');
      params.push(filters.recipient);
    }

    if (filters.userId) {
      conditions.push('(user_id = ? OR user_id IS NULL)');
      params.push(filters.userId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countQuery = `SELECT COUNT(*) as count FROM email_jobs ${whereClause}`;
    const [countRows] = await pool.query<(RowDataPacket & { count: number })[]>(countQuery, params);
    const total = countRows[0]?.count ?? 0;

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);

    const listQuery = `
      SELECT * FROM email_jobs
      ${whereClause}
      ORDER BY scheduled_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query<EmailJobRow[]>(listQuery, [...params, limit, offset]);
    return { total, emails: rows };
  }

  /**
   * Lists scheduled emails that are either PENDING or currently PROCESSING, scoped by user.
   */
  public static async findScheduled(
    limit: number = 50,
    offset: number = 0,
    userId?: string
  ): Promise<{ total: number; emails: EmailJobRecord[] }> {
    const pool = getDatabasePool();
    const conditions = ["status IN ('PENDING', 'PROCESSING')"];
    const params: (string | number)[] = [];

    if (userId) {
      conditions.push('(user_id = ? OR user_id IS NULL)');
      params.push(userId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countQuery = `SELECT COUNT(*) as count FROM email_jobs ${where}`;
    const [countRows] = await pool.query<(RowDataPacket & { count: number })[]>(countQuery, params);
    const total = countRows[0]?.count ?? 0;

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);

    const query = `
      SELECT * FROM email_jobs
      ${where}
      ORDER BY scheduled_at ASC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query<EmailJobRow[]>(query, [...params, safeLimit, safeOffset]);
    return { total, emails: rows };
  }

  /**
   * Lists completed emails that are either SENT or FAILED, scoped by user.
   */
  public static async findHistory(
    limit: number = 50,
    offset: number = 0,
    userId?: string
  ): Promise<{ total: number; emails: EmailJobRecord[] }> {
    const pool = getDatabasePool();
    const conditions = ["status IN ('SENT', 'FAILED', 'CANCELLED')"];
    const params: (string | number)[] = [];

    if (userId) {
      conditions.push('(user_id = ? OR user_id IS NULL)');
      params.push(userId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const countQuery = `SELECT COUNT(*) as count FROM email_jobs ${where}`;
    const [countRows] = await pool.query<(RowDataPacket & { count: number })[]>(countQuery, params);
    const total = countRows[0]?.count ?? 0;

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);

    const query = `
      SELECT * FROM email_jobs
      ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query<EmailJobRow[]>(query, [...params, safeLimit, safeOffset]);
    return { total, emails: rows };
  }

  /**
   * Transitions an email record to PROCESSING state and increments attempts.
   * Returns false if the email was already SENT or CANCELLED (safeguard against duplicate processing).
   */
  public static async markProcessing(id: string): Promise<{ canProcess: boolean; record: EmailJobRecord | null }> {
    const pool = getDatabasePool();
    const record = await this.findById(id);

    if (!record) {
      return { canProcess: false, record: null };
    }

    if (record.status === 'SENT' || record.status === 'CANCELLED') {
      return { canProcess: false, record };
    }

    const query = `
      UPDATE email_jobs
      SET status = 'PROCESSING',
          attempts = attempts + 1,
          last_attempt_at = NOW(3)
      WHERE id = ? AND status IN ('PENDING', 'FAILED')
    `;

    const [result] = await pool.query<ResultSetHeader>(query, [id]);
    if (result.affectedRows === 0) {
      const refreshed = await this.findById(id);
      return { canProcess: false, record: refreshed };
    }

    const updated = await this.findById(id);
    return { canProcess: true, record: updated };
  }

  /**
   * Marks an email record as successfully SENT with Ethereal delivery details.
   */
  public static async markSent(
    id: string,
    result: { messageId: string; previewUrl?: string | null }
  ): Promise<void> {
    const pool = getDatabasePool();
    const query = `
      UPDATE email_jobs
      SET status = 'SENT',
          sent_at = NOW(3),
          ethereal_message_id = ?,
          ethereal_preview_url = ?,
          error_message = NULL
      WHERE id = ?
    `;
    await pool.query<ResultSetHeader>(query, [result.messageId, result.previewUrl || null, id]);
  }

  /**
   * Marks an email record after a failure.
   * If willRetry is true, resets status to PENDING for subsequent worker attempts.
   * If willRetry is false, sets terminal FAILED status.
   */
  public static async markFailed(
    id: string,
    errorMessage: string,
    willRetry: boolean
  ): Promise<void> {
    const pool = getDatabasePool();
    const query = willRetry
      ? `
        UPDATE email_jobs
        SET status = 'PENDING',
            error_message = ?
        WHERE id = ?
      `
      : `
        UPDATE email_jobs
        SET status = 'FAILED',
            failed_at = NOW(3),
            error_message = ?
        WHERE id = ?
      `;

    await pool.query<ResultSetHeader>(query, [errorMessage, id]);
  }

  /**
   * Reschedules an email job when a sender reaches their hourly rate limit.
   * Updates status to PENDING, sets scheduled_at to nextEligibleDate,
   * decrements attempts back so rate-limiting does not burn the max_attempts quota,
   * and notes the reschedule reason.
   */
  public static async rescheduleForRateLimit(
    id: string,
    nextEligibleDate: Date,
    reason: string
  ): Promise<EmailJobRecord> {
    const pool = getDatabasePool();
    const query = `
      UPDATE email_jobs
      SET status = 'PENDING',
          scheduled_at = ?,
          attempts = GREATEST(0, attempts - 1),
          error_message = ?
      WHERE id = ?
    `;

    await pool.query<ResultSetHeader>(query, [nextEligibleDate, reason, id]);
    const updated = await this.findById(id);
    if (!updated) {
      throw new Error(`Email job ${id} not found after rate limit reschedule`);
    }
    return updated;
  }
}
