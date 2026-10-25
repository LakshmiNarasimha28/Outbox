import crypto from 'crypto';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getDatabasePool } from '../mysql';
import {
  SlackIntegrationRecord,
  UpsertSlackIntegrationInput,
  SlackIntegrationStatus,
} from '../models/slackIntegration';
import { EncryptionService } from '../../services/encryptionService';

export interface DecryptedSlackCredentials {
  accessToken: string | null;
  webhookUrl: string | null;
}

export class SlackRepository {
  /**
   * Upserts a Slack integration for a user, encrypting tokens at rest.
   */
  public static async upsert(
    input: UpsertSlackIntegrationInput
  ): Promise<SlackIntegrationRecord> {
    const pool = getDatabasePool();
    const id = input.id || crypto.randomUUID();

    const encryptedAccessToken = input.access_token
      ? EncryptionService.encrypt(input.access_token)
      : null;
    const encryptedWebhookUrl = input.webhook_url
      ? EncryptionService.encrypt(input.webhook_url)
      : null;

    const sql = `
      INSERT INTO slack_integrations (
        id, user_id, user_email, sender, team_id, team_name,
        channel_id, channel_name, encrypted_access_token, encrypted_webhook_url,
        scope, bot_user_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
      ON DUPLICATE KEY UPDATE
        user_email = VALUES(user_email),
        sender = VALUES(sender),
        team_id = VALUES(team_id),
        team_name = VALUES(team_name),
        channel_id = VALUES(channel_id),
        channel_name = VALUES(channel_name),
        encrypted_access_token = VALUES(encrypted_access_token),
        encrypted_webhook_url = VALUES(encrypted_webhook_url),
        scope = VALUES(scope),
        bot_user_id = VALUES(bot_user_id),
        status = 'ACTIVE',
        updated_at = CURRENT_TIMESTAMP(3)
    `;

    await pool.execute<ResultSetHeader>(sql, [
      id,
      input.user_id,
      input.user_email || null,
      input.sender,
      input.team_id,
      input.team_name,
      input.channel_id || null,
      input.channel_name || null,
      encryptedAccessToken,
      encryptedWebhookUrl,
      input.scope || null,
      input.bot_user_id || null,
    ]);

    const created = await this.findByUserId(input.user_id);
    if (!created) {
      throw new Error(`Failed to retrieve Slack integration after upsert for user: ${input.user_id}`);
    }
    return created;
  }

  /**
   * Finds the Slack integration for a specific user.
   */
  public static async findByUserId(
    userId: string
  ): Promise<SlackIntegrationRecord | null> {
    const pool = getDatabasePool();
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM slack_integrations WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) return null;
    return rows[0] as SlackIntegrationRecord;
  }

  /**
   * Finds the active Slack integration for a given sender email address.
   */
  public static async findActiveBySender(
    sender: string
  ): Promise<SlackIntegrationRecord | null> {
    const pool = getDatabasePool();
    const normalized = sender.trim().toLowerCase();

    // 1. Try matching by exact sender
    const [senderRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM slack_integrations WHERE sender = ? AND status = 'ACTIVE' LIMIT 1`,
      [normalized]
    );

    if (senderRows.length > 0) {
      return senderRows[0] as SlackIntegrationRecord;
    }

    // 2. Try matching by user_email
    const [emailRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM slack_integrations WHERE user_email = ? AND status = 'ACTIVE' LIMIT 1`,
      [normalized]
    );

    if (emailRows.length > 0) {
      return emailRows[0] as SlackIntegrationRecord;
    }

    // 3. Fallback to any active integration in system (e.g. workspace-wide webhook)
    const [anyActiveRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM slack_integrations WHERE status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1`
    );

    if (anyActiveRows.length > 0) {
      return anyActiveRows[0] as SlackIntegrationRecord;
    }

    return null;
  }

  /**
   * Disconnects a user's Slack integration by revoking/clearing tokens and marking status as DISCONNECTED.
   * Strictly isolated by userId.
   */
  public static async disconnect(userId: string): Promise<boolean> {
    const pool = getDatabasePool();
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE slack_integrations 
       SET status = 'DISCONNECTED', encrypted_access_token = NULL, encrypted_webhook_url = NULL, updated_at = CURRENT_TIMESTAMP(3)
       WHERE user_id = ?`,
      [userId]
    );

    return result.affectedRows > 0;
  }

  /**
   * Marks an integration as REVOKED when Slack returns invalid_auth or token_revoked.
   */
  public static async markRevoked(id: string): Promise<void> {
    const pool = getDatabasePool();
    await pool.execute(
      `UPDATE slack_integrations SET status = 'REVOKED', updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [id]
    );
  }

  /**
   * Decrypts encrypted access token and webhook URL for an integration record.
   */
  public static getDecryptedCredentials(
    integration: SlackIntegrationRecord
  ): DecryptedSlackCredentials {
    let accessToken: string | null = null;
    let webhookUrl: string | null = null;

    if (integration.encrypted_access_token) {
      try {
        accessToken = EncryptionService.decrypt(integration.encrypted_access_token);
      } catch (err) {
        console.warn(`[Slack] Failed to decrypt access token for integration ${integration.id}:`, err);
      }
    }

    if (integration.encrypted_webhook_url) {
      try {
        webhookUrl = EncryptionService.decrypt(integration.encrypted_webhook_url);
      } catch (err) {
        console.warn(`[Slack] Failed to decrypt webhook URL for integration ${integration.id}:`, err);
      }
    }

    return { accessToken, webhookUrl };
  }
}
