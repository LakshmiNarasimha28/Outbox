import crypto from 'crypto';
import { env } from '../config/env';
import { getSharedRedisClient } from '../queue/redis';
import { SlackRepository } from '../database/repositories/slackRepository';
import { SlackIntegrationRecord } from '../database/models/slackIntegration';

export interface SlackOAuthAccessResponse {
  ok: boolean;
  error?: string;
  app_id?: string;
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };
  scope?: string;
  token_type?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: {
    id: string;
    name: string;
  };
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

export interface SendRateLimitAlertParams {
  sender: string;
  limit: number;
  retryAfterMs: number;
  resumeTime: Date;
  userId?: string | null;
}

export interface SlackNotificationResult {
  sent: boolean;
  reason?: string;
  channel?: string | null;
  teamName?: string | null;
}

export interface SlackMockTransport {
  exchangeCode?: (code: string) => Promise<SlackOAuthAccessResponse>;
  sendWebhook?: (url: string, payload: any) => Promise<{ ok: boolean; status: number; text?: string }>;
  postMessage?: (token: string, channel: string, payload: any) => Promise<{ ok: boolean; error?: string }>;
}

export class SlackService {
  public static readonly STATE_COOKIE_NAME = 'slack_oauth_state';
  public static readonly STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
  public static readonly REQUIRED_SCOPES = ['incoming-webhook', 'chat:write'];

  private static mockTransport: SlackMockTransport | null = null;

  /**
   * Reports whether real Slack OAuth credentials are configured.
   */
  public static isConfigured(): boolean {
    return Boolean(
      this.mockTransport || (env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET)
    );
  }

  /**
   * Injects mock transport for isolated automated testing.
   */
  public static setMockTransport(mock: SlackMockTransport | null): void {
    this.mockTransport = mock;
  }

  /**
   * Generates a cryptographically random OAuth state string.
   */
  public static generateState(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /**
   * Generates the Slack OAuth v2 authorization URL.
   */
  public static generateAuthUrl(state: string): string {
    if (!this.isConfigured()) {
      throw new Error(
        'Slack OAuth is not configured. Please define SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in backend/.env.'
      );
    }

    const clientId = env.SLACK_CLIENT_ID || 'mock-slack-client-id';
    const redirectUri = encodeURIComponent(env.SLACK_CALLBACK_URL);
    const scope = encodeURIComponent(this.REQUIRED_SCOPES.join(','));

    return `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(
      clientId
    )}&scope=${scope}&state=${encodeURIComponent(state)}&redirect_uri=${redirectUri}`;
  }

  /**
   * Exchanges an authorization code for Slack access tokens and webhook metadata.
   */
  public static async exchangeCodeForTokens(code: string): Promise<SlackOAuthAccessResponse> {
    if (this.mockTransport?.exchangeCode) {
      return this.mockTransport.exchangeCode(code);
    }

    if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
      throw new Error('Slack OAuth credentials missing in backend environment.');
    }

    const params = new URLSearchParams();
    params.append('client_id', env.SLACK_CLIENT_ID);
    params.append('client_secret', env.SLACK_CLIENT_SECRET);
    params.append('code', code);
    params.append('redirect_uri', env.SLACK_CALLBACK_URL);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Slack API responded with HTTP status ${res.status}`);
      }

      const data = (await res.json()) as SlackOAuthAccessResponse;
      if (!data.ok) {
        throw new Error(`Slack OAuth error: ${data.error || 'Unknown error'}`);
      }

      return data;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Slack OAuth token exchange timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Formats the Block Kit payload for an hourly rate limit alert.
   * STRICT SECURITY GUARANTEE: Does not include email bodies, recipients, or credentials.
   */
  public static buildRateLimitAlertPayload(params: {
    sender: string;
    limit: number;
    retryAfterMs: number;
    resumeTime: Date;
  }): any {
    const formattedDate = params.resumeTime.toUTCString();
    const minutesLeft = Math.ceil(params.retryAfterMs / 60000);

    return {
      text: `⚠️ Hourly Rate Limit Reached for ${params.sender}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '⚠️ Hourly Email Limit Reached',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Sender \`${params.sender}\` has reached its configured hourly limit of *${params.limit} emails*. All subsequent emails have been automatically rescheduled to protect delivery reputation and prevent quota drops.`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Sender:*\n\`${params.sender}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Hourly Quota:*\n${params.limit} emails / hour`,
            },
            {
              type: 'mrkdwn',
              text: `*Resumes At:*\n${formattedDate}`,
            },
            {
              type: 'mrkdwn',
              text: `*Estimated Wait:*\n~${minutesLeft} minute(s)`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '🛡️ *Outbox Labs Scheduler* • Distributed Atomic Rate Limiter • Safe Redis Reschedule',
            },
          ],
        },
      ],
    };
  }

  /**
   * Sends a rate-limit alert to the active Slack integration with deduplication / cooldown protection.
   * Completely resilient: NEVER throws or fails the email worker job if Slack fails.
   */
  public static async sendRateLimitNotification(
    params: SendRateLimitAlertParams
  ): Promise<SlackNotificationResult> {
    const redis = getSharedRedisClient();
    const cooldownSeconds = env.SLACK_NOTIFICATION_COOLDOWN_SECONDS;
    const normalizedSender = params.sender.trim().toLowerCase();

    // 1. Deduplication / Cooldown Check via Redis
    if (redis) {
      const cooldownKey = `slack:ratelimit:cooldown:${encodeURIComponent(normalizedSender)}`;
      try {
        const acquired = await redis.set(cooldownKey, '1', 'EX', cooldownSeconds, 'NX');
        if (!acquired) {
          console.log(
            `[Slack] Rate limit alert for ${params.sender} suppressed by active cooldown (${cooldownSeconds}s).`
          );
          return { sent: false, reason: 'COOLDOWN_ACTIVE' };
        }
      } catch (err) {
        console.warn('[Slack] Failed to verify cooldown in Redis, proceeding carefully:', err);
      }
    }

    // 2. Find active Slack integration
    let integration: SlackIntegrationRecord | null = null;
    try {
      integration = await SlackRepository.findActiveBySender(params.sender);
    } catch (err) {
      console.warn('[Slack] Database query failed while searching for Slack integration:', err);
      return { sent: false, reason: 'DB_ERROR' };
    }

    if (!integration) {
      console.log(`[Slack] No active Slack integration found for sender ${params.sender}.`);
      return { sent: false, reason: 'NO_ACTIVE_INTEGRATION' };
    }

    const { accessToken, webhookUrl } = SlackRepository.getDecryptedCredentials(integration);
    if (!accessToken && !webhookUrl) {
      console.warn(`[Slack] Integration ${integration.id} exists but has no valid credentials.`);
      return { sent: false, reason: 'MISSING_CREDENTIALS' };
    }

    const payload = this.buildRateLimitAlertPayload({
      sender: params.sender,
      limit: params.limit,
      retryAfterMs: params.retryAfterMs,
      resumeTime: params.resumeTime,
    });

    // 3. Dispatch Notification via Mock or Network
    try {
      if (this.mockTransport) {
        if (this.mockTransport.sendWebhook && webhookUrl) {
          const res = await this.mockTransport.sendWebhook(webhookUrl, payload);
          if (!res.ok) {
            if (res.status === 404 || res.status === 410) {
              await SlackRepository.markRevoked(integration.id);
            }
            return { sent: false, reason: `MOCK_WEBHOOK_FAILED: ${res.status}` };
          }
        } else if (this.mockTransport.postMessage && accessToken && integration.channel_id) {
          const res = await this.mockTransport.postMessage(accessToken, integration.channel_id, payload);
          if (!res.ok) {
            if (
              res.error === 'token_revoked' ||
              res.error === 'invalid_auth' ||
              res.error === 'account_inactive'
            ) {
              await SlackRepository.markRevoked(integration.id);
            }
            return { sent: false, reason: `MOCK_POST_MESSAGE_FAILED: ${res.error}` };
          }
        }
        return {
          sent: true,
          channel: integration.channel_name,
          teamName: integration.team_name,
        };
      }

      // Priority 1: Incoming Webhook (if provided during OAuth installation)
      if (webhookUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        try {
          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (!response.ok) {
            if (response.status === 404 || response.status === 410) {
              await SlackRepository.markRevoked(integration.id);
            }
            console.warn(`[Slack Webhook] Failed with status ${response.status}`);
            return { sent: false, reason: `HTTP_${response.status}` };
          }
        } finally {
          clearTimeout(timeout);
        }
      } else if (accessToken && integration.channel_id) {
        // Priority 2: chat.postMessage API using bot token
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        try {
          const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              channel: integration.channel_id,
              ...payload,
            }),
            signal: controller.signal,
          });

          const data: any = await response.json();
          if (!data.ok) {
            if (data.error === 'token_revoked' || data.error === 'invalid_auth' || data.error === 'account_inactive') {
              await SlackRepository.markRevoked(integration.id);
            }
            console.warn(`[Slack API] chat.postMessage failed: ${data.error}`);
            return { sent: false, reason: data.error };
          }
        } finally {
          clearTimeout(timeout);
        }
      }

      console.log(
        `[Slack] Rate limit alert successfully dispatched to ${integration.team_name} (#${integration.channel_name || 'alerts'}).`
      );
      return {
        sent: true,
        channel: integration.channel_name,
        teamName: integration.team_name,
      };
    } catch (err: any) {
      console.warn('[Slack Alert Delivery Error]', err instanceof Error ? err.message : err);
      return { sent: false, reason: err.message || 'DELIVERY_ERROR' };
    }
  }
}
