import { Request, Response } from 'express';
import { SlackService } from '../services/slackService';
import { SlackRepository } from '../database/repositories/slackRepository';
import { env } from '../config/env';

export class SlackController {
  /**
   * Initiates Slack OAuth v2 flow by generating CSRF state and redirecting to Slack.
   * GET /api/slack/authorize (or /api/auth/slack)
   */
  public static async initiateSlackAuth(req: Request, res: Response): Promise<void> {
    if (!SlackService.isConfigured()) {
      res.status(503).json({
        success: false,
        error: 'SlackNotConfigured',
        message: 'Slack OAuth credentials are not configured in the backend environment.',
      });
      return;
    }

    const state = SlackService.generateState();
    const isProduction = env.NODE_ENV === 'production';

    res.cookie(SlackService.STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      signed: true,
      maxAge: SlackService.STATE_MAX_AGE_MS,
    });

    const authUrl = SlackService.generateAuthUrl(state);
    res.redirect(authUrl);
  }

  /**
   * Handles OAuth v2 redirect callback from Slack.
   * GET /api/auth/slack/callback (or /api/slack/callback)
   */
  public static async handleSlackCallback(req: Request, res: Response): Promise<void> {
    const { code, state, error, error_description } = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    // 1. Handle user-denied consent or Slack error
    if (error) {
      console.warn(`[Slack Warning] OAuth callback returned error: ${error} - ${error_description}`);
      res.redirect(`/?slack_error=${encodeURIComponent(error_description || error)}`);
      return;
    }

    // 2. Validate CSRF state
    const cookieState =
      req.signedCookies?.[SlackService.STATE_COOKIE_NAME] ||
      req.cookies?.[SlackService.STATE_COOKIE_NAME];

    res.clearCookie(SlackService.STATE_COOKIE_NAME);

    if (!state || !cookieState || state !== cookieState) {
      console.warn('[Slack Security] State mismatch or expired state in Slack OAuth callback.');
      res.redirect('/?slack_error=Invalid%20or%20expired%20OAuth%20state');
      return;
    }

    if (!code) {
      res.redirect('/?slack_error=Missing%20authorization%20code');
      return;
    }

    try {
      // 3. Exchange code for access tokens and webhook
      const tokenResponse = await SlackService.exchangeCodeForTokens(code);

      // Determine owning user (from session or default)
      const userId = req.user?.id || 'legacy-system-user';
      const userEmail = req.user?.email || env.DEFAULT_SENDER;
      const sender = req.user?.email || env.DEFAULT_SENDER;

      // 4. Persist encrypted credentials into MySQL
      await SlackRepository.upsert({
        user_id: userId,
        user_email: userEmail,
        sender,
        team_id: tokenResponse.team?.id || 'unknown-team',
        team_name: tokenResponse.team?.name || 'Slack Workspace',
        channel_id: tokenResponse.incoming_webhook?.channel_id || null,
        channel_name: tokenResponse.incoming_webhook?.channel || null,
        access_token: tokenResponse.access_token || null,
        webhook_url: tokenResponse.incoming_webhook?.url || null,
        scope: tokenResponse.scope || null,
        bot_user_id: tokenResponse.bot_user_id || null,
      });

      console.log(
        `[Slack] Successfully connected workspace: ${tokenResponse.team?.name} (#${tokenResponse.incoming_webhook?.channel || 'alerts'}) for user: ${userEmail}`
      );

      res.redirect('/?slack_auth=success');
    } catch (err: any) {
      console.error('[Slack OAuth Error]', err instanceof Error ? err.message : err);
      res.redirect(`/?slack_error=${encodeURIComponent(err.message || 'OAuth token exchange failed')}`);
    }
  }

  /**
   * Retrieves Slack connection status for the authenticated user.
   * GET /api/slack/status
   * STRICT SECURITY GUARANTEE: Never exposes access tokens or raw webhook URLs!
   */
  public static async getSlackStatus(req: Request, res: Response): Promise<void> {
    const configured = SlackService.isConfigured();
    const userId = req.user?.id || 'legacy-system-user';

    try {
      const integration = await SlackRepository.findByUserId(userId);

      if (!integration || integration.status !== 'ACTIVE') {
        res.json({
          success: true,
          configured,
          connected: false,
          integration: null,
        });
        return;
      }

      res.json({
        success: true,
        configured,
        connected: true,
        integration: {
          teamId: integration.team_id,
          teamName: integration.team_name,
          channelId: integration.channel_id,
          channelName: integration.channel_name,
          sender: integration.sender,
          status: integration.status,
          connectedAt: integration.updated_at,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'DatabaseError',
        message: err instanceof Error ? err.message : 'Failed to query Slack status',
      });
    }
  }

  /**
   * Disconnects the user's Slack integration.
   * POST /api/slack/disconnect
   */
  public static async disconnectSlack(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id || 'legacy-system-user';

    try {
      const success = await SlackRepository.disconnect(userId);
      res.json({
        success: true,
        message: success
          ? 'Slack integration disconnected successfully.'
          : 'No active integration to disconnect.',
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'DisconnectError',
        message: err instanceof Error ? err.message : 'Failed to disconnect Slack',
      });
    }
  }

  /**
   * Dispatches a manual test rate-limit notification to verify channel alerts.
   * POST /api/slack/test-notification
   */
  public static async sendTestNotification(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id || 'legacy-system-user';
    const sender = req.user?.email || env.DEFAULT_SENDER;

    try {
      const integration = await SlackRepository.findByUserId(userId);
      if (!integration || integration.status !== 'ACTIVE') {
        res.status(400).json({
          success: false,
          error: 'NotConnected',
          message: 'No active Slack connection found. Please connect Slack first.',
        });
        return;
      }

      // Bypass cooldown for manual test notification
      const result = await SlackService.sendRateLimitNotification({
        sender,
        limit: env.HOURLY_RATE_LIMIT,
        retryAfterMs: 3600000,
        resumeTime: new Date(Date.now() + 3600000),
        userId,
      });

      res.json({
        success: result.sent,
        message: result.sent
          ? `Test rate-limit alert dispatched to ${result.teamName} (#${result.channel || 'channel'}).`
          : `Alert dispatch did not complete: ${result.reason}`,
        details: result,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: 'TestNotificationError',
        message: err instanceof Error ? err.message : 'Failed to send test notification',
      });
    }
  }
}
