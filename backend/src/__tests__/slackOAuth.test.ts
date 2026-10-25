import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { AuthService } from '../services/authService';
import { SlackService } from '../services/slackService';
import { SlackRepository } from '../database/repositories/slackRepository';
import { EncryptionService } from '../services/encryptionService';
import { getSharedRedisClient, closeRedisConnection } from '../queue/redis';
import { closeDatabasePool } from '../database/mysql';
import { closeEmailQueue } from '../queue/emailQueue';

describe('Slack OAuth v2 & Hourly Rate-Limit Notification Tests', () => {
  const testUserA = {
    id: 'slack-test-user-aaa',
    email: 'user-a@outbox.labs',
    name: 'Engineer Alice',
    avatar: 'https://example.com/avatar-a.jpg',
  };

  const testUserB = {
    id: 'slack-test-user-bbb',
    email: 'user-b@outbox.labs',
    name: 'Engineer Bob',
    avatar: null,
  };

  const app = createApp();
  let tokenUserA: string;
  let tokenUserB: string;

  before(async () => {
    tokenUserA = AuthService.signSessionToken(testUserA);
    tokenUserB = AuthService.signSessionToken(testUserB);
  });

  after(async () => {
    SlackService.setMockTransport(null);
    try {
      await SlackRepository.deleteByUserId(testUserA.id);
      await SlackRepository.deleteByUserId(testUserB.id);
      await SlackRepository.deleteByUserId('revoked-test-user');
      await SlackRepository.deleteByUserId('fallback-test-user');
    } catch {
      // Ignore cleanup error if already removed
    }
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  beforeEach(async () => {
    SlackService.setMockTransport(null);
    const redis = getSharedRedisClient();
    if (redis) {
      await redis.del(`slack:ratelimit:cooldown:${encodeURIComponent(testUserA.email)}`);
      await redis.del(`slack:ratelimit:cooldown:${encodeURIComponent(env.DEFAULT_SENDER)}`);
    }
  });

  it('should return 503 when Slack OAuth is not configured and no mock transport is set', async () => {
    const originalId = env.SLACK_CLIENT_ID;
    const originalSecret = env.SLACK_CLIENT_SECRET;
    (env as any).SLACK_CLIENT_ID = undefined;
    (env as any).SLACK_CLIENT_SECRET = undefined;

    try {
      const res = await request(app).get('/api/slack/authorize');
      assert.equal(res.status, 503);
      assert.equal(res.body.error, 'SlackNotConfigured');
    } finally {
      (env as any).SLACK_CLIENT_ID = originalId;
      (env as any).SLACK_CLIENT_SECRET = originalSecret;
    }
  });

  it('should initiate Slack OAuth flow, set signed state cookie, and redirect to slack.com/oauth/v2/authorize', async () => {
    (env as any).SLACK_CLIENT_ID = 'slack-test-client-id-123';
    (env as any).SLACK_CLIENT_SECRET = 'slack-test-client-secret-456';

    const res = await request(app).get('/api/slack/authorize');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location);

    const redirectUrl = new URL(res.headers.location);
    assert.equal(redirectUrl.origin, 'https://slack.com');
    assert.equal(redirectUrl.pathname, '/oauth/v2/authorize');
    assert.equal(redirectUrl.searchParams.get('client_id'), 'slack-test-client-id-123');
    assert.ok(redirectUrl.searchParams.get('state'), 'Should include state param');
    assert.equal(redirectUrl.searchParams.get('scope'), 'incoming-webhook,chat:write');

    const rawCookies = res.headers['set-cookie'];
    const cookies: string[] = ([].concat(rawCookies as any)) as string[];
    assert.ok(cookies.some((c) => c.includes(SlackService.STATE_COOKIE_NAME)));
  });

  it('should handle cancelled consent in Slack OAuth callback gracefully', async () => {
    const res = await request(app).get(
      '/api/slack/callback?error=access_denied&error_description=User%20denied%20installation'
    );

    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('slack_error=User%20denied%20installation'));
  });

  it('should reject callback with invalid or mismatched CSRF state', async () => {
    const res = await request(app)
      .get('/api/slack/callback?code=mock-code&state=forged-state')
      .set('Cookie', [`${SlackService.STATE_COOKIE_NAME}=s%3Aactual-state.signature`]);

    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('slack_error=Invalid%20or%20expired%20OAuth%20state'));
  });

  it('should exchange code for tokens, encrypt credentials at rest, and expose status without leaking tokens', async () => {
    const validState = 'secure-slack-state-987';
    let exchangedCode = '';

    SlackService.setMockTransport({
      exchangeCode: async (code: string) => {
        exchangedCode = code;
        return {
          ok: true,
          app_id: 'A_TEST_APP',
          team: {
            id: 'T_OUTBOX_CORP',
            name: 'Outbox Corporation',
          },
          scope: 'incoming-webhook,chat:write',
          access_token: 'xoxb-real-secret-token-12345',
          bot_user_id: 'B_BOT_USER',
          incoming_webhook: {
            channel: 'alerts-prod',
            channel_id: 'C_ALERTS_PROD',
            configuration_url: 'https://outbox.slack.com/services/123',
            url: 'https://hooks.slack.com/services/T123/B456/webhook-secret-789',
          },
        };
      },
    });

    // 1. Simulate callback with matching signed cookie
    const authRes = await request(app).get('/api/slack/authorize');
    const cookies: string[] = ([].concat(authRes.headers['set-cookie'] as any)) as string[];
    const stateCookie = cookies.find((c) => c.includes(SlackService.STATE_COOKIE_NAME));
    assert.ok(stateCookie);

    const redirectUrl = new URL(authRes.headers.location);
    const generatedState = redirectUrl.searchParams.get('state')!;

    const callbackRes = await request(app)
      .get(`/api/slack/callback?code=valid-slack-auth-code&state=${generatedState}`)
      .set('Cookie', [stateCookie])
      .set('Authorization', `Bearer ${tokenUserA}`);

    assert.equal(callbackRes.status, 302);
    assert.ok(callbackRes.headers.location.includes('slack_auth=success'));
    assert.equal(exchangedCode, 'valid-slack-auth-code');

    // 2. Query database directly to confirm tokens are encrypted at rest
    const dbRecord = await SlackRepository.findByUserId(testUserA.id);
    assert.ok(dbRecord);
    assert.equal(dbRecord.team_id, 'T_OUTBOX_CORP');
    assert.equal(dbRecord.channel_name, 'alerts-prod');

    // Security Verification: tokens must NOT be stored in plain text
    assert.notEqual(dbRecord.encrypted_access_token, 'xoxb-real-secret-token-12345');
    assert.notEqual(
      dbRecord.encrypted_webhook_url,
      'https://hooks.slack.com/services/T123/B456/webhook-secret-789'
    );
    assert.ok(dbRecord.encrypted_access_token?.includes(':'), 'Should use iv:tag:hex cipher format');

    // Decryption verification
    const creds = SlackRepository.getDecryptedCredentials(dbRecord);
    assert.equal(creds.accessToken, 'xoxb-real-secret-token-12345');
    assert.equal(creds.webhookUrl, 'https://hooks.slack.com/services/T123/B456/webhook-secret-789');

    // 3. Query GET /api/slack/status through API
    const statusRes = await request(app)
      .get('/api/slack/status')
      .set('Authorization', `Bearer ${tokenUserA}`);

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.connected, true);
    assert.equal(statusRes.body.integration.teamName, 'Outbox Corporation');
    assert.equal(statusRes.body.integration.channelName, 'alerts-prod');

    // STRICT CHECK: Ensure access_token and webhook_url are NOT exposed in API response
    assert.equal(statusRes.body.integration.access_token, undefined);
    assert.equal(statusRes.body.integration.webhook_url, undefined);
    assert.equal(statusRes.body.integration.encrypted_access_token, undefined);
  });

  it('should enforce connection isolation between different users', async () => {
    // User A is connected from previous test. User B should be disconnected.
    const statusResB = await request(app)
      .get('/api/slack/status')
      .set('Authorization', `Bearer ${tokenUserB}`);

    assert.equal(statusResB.status, 200);
    assert.equal(statusResB.body.connected, false);
    assert.equal(statusResB.body.integration, null);

    // User B tries to disconnect — must not affect User A
    const disconnectResB = await request(app)
      .post('/api/slack/disconnect')
      .set('Authorization', `Bearer ${tokenUserB}`);

    assert.equal(disconnectResB.status, 200);
    assert.equal(disconnectResB.body.message, 'No active integration to disconnect.');

    // User A must still be connected
    const statusResA = await request(app)
      .get('/api/slack/status')
      .set('Authorization', `Bearer ${tokenUserA}`);
    assert.equal(statusResA.body.connected, true);
  });

  it('should allow user to disconnect and clear active credentials', async () => {
    const disconnectRes = await request(app)
      .post('/api/slack/disconnect')
      .set('Authorization', `Bearer ${tokenUserA}`);

    assert.equal(disconnectRes.status, 200);
    assert.equal(disconnectRes.body.success, true);

    const statusRes = await request(app)
      .get('/api/slack/status')
      .set('Authorization', `Bearer ${tokenUserA}`);

    assert.equal(statusRes.body.connected, false);
    assert.equal(statusRes.body.integration, null);
  });

  it('should send formatted rate-limit notification and deduplicate subsequent alerts with cooldown', async () => {
    // Reconnect User A for notification testing
    await SlackRepository.upsert({
      user_id: testUserA.id,
      user_email: testUserA.email,
      sender: testUserA.email,
      team_id: 'T_OUTBOX_ALERTS',
      team_name: 'Outbox Alerts Team',
      channel_id: 'C_ALERTS_TEST',
      channel_name: 'alerts-hourly',
      access_token: 'xoxb-mock-notification-token',
      webhook_url: 'https://hooks.slack.com/services/TEST/NOTIF/WEBHOOK',
    });

    let sentPayload: any = null;
    let webhookCalls = 0;

    SlackService.setMockTransport({
      sendWebhook: async (url: string, payload: any) => {
        webhookCalls++;
        sentPayload = payload;
        assert.equal(url, 'https://hooks.slack.com/services/TEST/NOTIF/WEBHOOK');
        return { ok: true, status: 200 };
      },
    });

    const resumeTime = new Date(Date.now() + 3600000);

    // 1. First trigger — should dispatch notification
    const result1 = await SlackService.sendRateLimitNotification({
      sender: testUserA.email,
      limit: 10,
      retryAfterMs: 3600000,
      resumeTime,
      userId: testUserA.id,
    });

    assert.equal(result1.sent, true);
    assert.equal(webhookCalls, 1);
    assert.ok(sentPayload);
    assert.ok(sentPayload.text.includes('Hourly Rate Limit Reached'));

    // Check Block Kit structure
    const blockText = JSON.stringify(sentPayload.blocks);
    assert.ok(blockText.includes(testUserA.email), 'Should contain sender identifier');
    assert.ok(blockText.includes('10 emails / hour'), 'Should state quota limit');

    // Strict privacy guarantee: no recipient emails, no email bodies, no tokens
    assert.equal(blockText.includes('xoxb-'), false);
    assert.equal(blockText.includes('candidate@example.com'), false);

    // 2. Second trigger immediately after — MUST be suppressed by Redis cooldown
    const result2 = await SlackService.sendRateLimitNotification({
      sender: testUserA.email,
      limit: 10,
      retryAfterMs: 3500000,
      resumeTime,
      userId: testUserA.id,
    });

    assert.equal(result2.sent, false);
    assert.equal(result2.reason, 'COOLDOWN_ACTIVE');
    assert.equal(webhookCalls, 1, 'Webhook should not be called a second time during active cooldown');
  });

  it('should mark integration as REVOKED and handle Slack delivery failures without throwing', async () => {
    const redis = getSharedRedisClient();
    if (redis) {
      await redis.del(`slack:ratelimit:cooldown:${encodeURIComponent('revoked-test@outbox.labs')}`);
    }

    const revokedUser = {
      id: 'revoked-test-user',
      email: 'revoked-test@outbox.labs',
    };

    await SlackRepository.upsert({
      user_id: revokedUser.id,
      user_email: revokedUser.email,
      sender: revokedUser.email,
      team_id: 'T_REVOKED_CORP',
      team_name: 'Revoked Corp',
      channel_id: 'C_REVOKED',
      channel_name: 'dead-channel',
      webhook_url: 'https://hooks.slack.com/services/REVOKED/URL',
    });

    SlackService.setMockTransport({
      sendWebhook: async () => {
        // Simulate Slack webhook being deleted / 404
        return { ok: false, status: 404, text: 'channel_not_found' };
      },
    });

    // Should return sent: false cleanly and not throw
    const result = await SlackService.sendRateLimitNotification({
      sender: revokedUser.email,
      limit: 10,
      retryAfterMs: 3600000,
      resumeTime: new Date(Date.now() + 3600000),
      userId: revokedUser.id,
    });

    assert.equal(result.sent, false);
    assert.ok(result.reason?.includes('404'));

    // Check DB status was transitioned to REVOKED
    const record = await SlackRepository.findByUserId(revokedUser.id);
    assert.equal(record?.status, 'REVOKED');

    // Subsequent notifications should be skipped because status is REVOKED
    const subsequentResult = await SlackService.sendRateLimitNotification({
      sender: revokedUser.email,
      limit: 10,
      retryAfterMs: 3600000,
      resumeTime: new Date(Date.now() + 3600000),
      userId: revokedUser.id,
    });
    assert.equal(subsequentResult.sent, false);
    assert.equal(subsequentResult.reason, 'NO_ACTIVE_INTEGRATION');

    // Verify GET /api/slack/status reports isRevoked: true and reconnect guidance
    const revokedToken = AuthService.signSessionToken({
      id: revokedUser.id,
      email: revokedUser.email,
      name: 'Revoked User',
      avatar: null,
    });
    const statusRes = await request(app)
      .get('/api/slack/status')
      .set('Authorization', `Bearer ${revokedToken}`);

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.connected, false);
    assert.equal(statusRes.body.isRevoked, true);
    assert.ok(statusRes.body.message?.includes('reconnect'));
  });

  it('should fall back to chat.postMessage API when incoming webhook returns 404', async () => {
    const fallbackUser = {
      id: 'fallback-test-user',
      email: 'fallback-test@outbox.labs',
    };

    const redis = getSharedRedisClient();
    if (redis) {
      await redis.del(`slack:ratelimit:cooldown:${encodeURIComponent(fallbackUser.email)}`);
    }

    await SlackRepository.upsert({
      user_id: fallbackUser.id,
      user_email: fallbackUser.email,
      sender: fallbackUser.email,
      team_id: 'T_FALLBACK_CORP',
      team_name: 'Fallback Corp',
      channel_id: 'C_FALLBACK',
      channel_name: 'alerts-fallback',
      access_token: 'xoxb-valid-bot-token',
      webhook_url: 'https://hooks.slack.com/services/DEAD/WEBHOOK/404',
    });

    let webhookAttempted = false;
    let postMessageAttempted = false;

    SlackService.setMockTransport({
      sendWebhook: async () => {
        webhookAttempted = true;
        // Simulate dead webhook returning HTTP 404
        return { ok: false, status: 404, text: 'No service' };
      },
      postMessage: async (token, channel, _payload) => {
        postMessageAttempted = true;
        assert.equal(token, 'xoxb-valid-bot-token');
        assert.equal(channel, 'C_FALLBACK');
        return { ok: true };
      },
    });

    const result = await SlackService.sendRateLimitNotification({
      sender: fallbackUser.email,
      limit: 10,
      retryAfterMs: 3600000,
      resumeTime: new Date(Date.now() + 3600000),
      userId: fallbackUser.id,
    });

    assert.ok(webhookAttempted, 'Should attempt incoming webhook first');
    assert.ok(postMessageAttempted, 'Should fall back to chat.postMessage when webhook gives 404');
    assert.equal(result.sent, true, 'Alert should be delivered successfully via fallback');
    assert.equal(result.channel, 'alerts-fallback');

    // Integration should still be ACTIVE because fallback succeeded
    const record = await SlackRepository.findByUserId(fallbackUser.id);
    assert.equal(record?.status, 'ACTIVE');
  });
});
