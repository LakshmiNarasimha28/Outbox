import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { env } from '../config/env';

export class AuthController {
  /**
   * Initiates Google OAuth 2.0 login by generating a CSRF state and redirecting to Google.
   * GET /api/auth/google
   */
  public static async initiateGoogleAuth(req: Request, res: Response): Promise<void> {
    if (!AuthService.isConfigured()) {
      res.status(503).json({
        success: false,
        error: 'Google OAuth is not configured. Please define GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.',
      });
      return;
    }

    try {
      const state = AuthService.generateState();
      res.cookie(
        AuthService.STATE_COOKIE_NAME,
        state,
        AuthService.getStateCookieOptions()
      );

      const authUrl = AuthService.generateAuthUrl(state);

      // If client requests JSON representation (e.g. for modal or SPA popup)
      if (req.query.format === 'json') {
        res.json({ success: true, url: authUrl });
        return;
      }

      // Otherwise direct browser redirect (standard 302)
      res.redirect(authUrl);
    } catch (err: any) {
      console.error('[Auth Error] Failed to generate OAuth initiation URL:', err.message);
      res.status(500).json({
        success: false,
        error: 'Failed to initiate Google authentication.',
        message: err.message,
      });
    }
  }

  /**
   * Handles Google OAuth callback, verifies CSRF state, exchanges code for user profile,
   * creates session cookie, and redirects to frontend.
   * GET /api/auth/google/callback
   */
  public static async handleGoogleCallback(req: Request, res: Response): Promise<void> {
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
    const frontendBase = env.CORS_ORIGIN || 'http://localhost:5173';

    // 1. Handle user cancellation or Google error
    if (error) {
      res.clearCookie(AuthService.STATE_COOKIE_NAME, { path: '/' });
      const reason = error_description || error;
      console.warn(`[OAuth Warning] Google OAuth callback returned error: ${reason}`);
      res.redirect(`${frontendBase}/?auth_error=${encodeURIComponent(reason)}`);
      return;
    }

    // 2. Validate presence of code and state
    if (!code || !state) {
      res.clearCookie(AuthService.STATE_COOKIE_NAME, { path: '/' });
      res.status(400).redirect(`${frontendBase}/?auth_error=Missing+authorization+code+or+state`);
      return;
    }

    // 3. Verify CSRF state against stored cookie
    const storedState = req.cookies?.[AuthService.STATE_COOKIE_NAME];
    res.clearCookie(AuthService.STATE_COOKIE_NAME, { path: '/' });

    if (!storedState || storedState !== state) {
      console.warn('[OAuth Security] State mismatch or expired state in OAuth callback.');
      res.status(400).redirect(`${frontendBase}/?auth_error=Invalid+or+expired+OAuth+CSRF+state`);
      return;
    }

    // 4. Exchange code for verified Google identity
    try {
      const user = await AuthService.verifyCodeAndGetProfile(code);
      const sessionToken = AuthService.signSessionToken(user);

      // 5. Set HttpOnly signed session cookie
      res.cookie(
        AuthService.SESSION_COOKIE_NAME,
        sessionToken,
        AuthService.getSessionCookieOptions()
      );

      console.log(`[OAuth] Successfully authenticated user: ${user.email} (${user.id})`);
      res.redirect(`${frontendBase}/?auth_success=true`);
    } catch (err: any) {
      console.error('[OAuth Error] Failed to process OAuth callback:', err.message);
      res.redirect(`${frontendBase}/?auth_error=${encodeURIComponent(err.message || 'Authentication failed')}`);
    }
  }

  /**
   * Returns current authenticated user profile, or unauthenticated status.
   * GET /api/auth/me
   */
  public static async getMe(req: Request, res: Response): Promise<void> {
    if (req.user) {
      res.json({
        success: true,
        authenticated: true,
        user: {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          avatar: req.user.avatar,
        },
      });
      return;
    }

    res.json({
      success: true,
      authenticated: false,
      user: null,
    });
  }

  /**
   * Logs out the user by clearing the session cookie.
   * POST /api/auth/logout
   */
  public static async logout(_req: Request, res: Response): Promise<void> {
    res.clearCookie(AuthService.SESSION_COOKIE_NAME, { path: '/' });
    res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  }
}
