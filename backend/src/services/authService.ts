import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export interface AuthUser {
  id: string; // Google Subject ID
  email: string;
  name: string;
  avatar: string | null;
}

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  avatar: string | null;
  iat?: number;
  exp?: number;
}

export class AuthService {
  private static oauthClient: OAuth2Client | null = null;
  public static readonly SESSION_COOKIE_NAME = 'outbox_session';
  public static readonly STATE_COOKIE_NAME = 'oauth_state';
  public static readonly SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Reports whether real Google OAuth credentials are configured in the environment.
   */
  public static isConfigured(): boolean {
    return Boolean(
      this.oauthClient || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    );
  }

  /**
   * Lazily initializes and returns the Google OAuth2 client.
   */
  public static getOAuthClient(): OAuth2Client {
    if (this.oauthClient) {
      return this.oauthClient;
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new Error(
        'Google OAuth is not configured. Please define GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.'
      );
    }

    this.oauthClient = new OAuth2Client({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_CALLBACK_URL,
    });

    return this.oauthClient;
  }

  /**
   * Injects a mock OAuth2Client (used exclusively for isolated unit/integration tests).
   */
  public static setOAuthClient(mockClient: OAuth2Client | null): void {
    this.oauthClient = mockClient;
  }

  /**
   * Generates a cryptographically secure random CSRF state string.
   */
  public static generateState(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  /**
   * Generates the Google OAuth 2.0 authorization URL.
   */
  public static generateAuthUrl(state: string): string {
    const client = this.getOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'profile', 'email'],
      prompt: 'consent',
      state,
    });
  }

  /**
   * Exchanges an authorization code for tokens and extracts verified Google profile information.
   */
  public static async verifyCodeAndGetProfile(code: string): Promise<AuthUser> {
    const client = this.getOAuthClient();

    // 1. Exchange authorization code for tokens
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    if (!tokens.id_token) {
      throw new Error('Google did not return an id_token in OAuth response.');
    }

    // 2. Cryptographically verify the Google ID token
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error('Invalid Google ID token payload or missing email/sub.');
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split('@')[0],
      avatar: payload.picture || null,
    };
  }

  /**
   * Signs a secure JWT containing the user identity.
   */
  public static signSessionToken(user: AuthUser): string {
    const payload: SessionPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    };

    return jwt.sign(payload, env.SESSION_SECRET, {
      expiresIn: '7d',
      algorithm: 'HS256',
    });
  }

  /**
   * Verifies and decodes a session JWT. Returns null if invalid or expired.
   */
  public static verifySessionToken(token: string): AuthUser | null {
    try {
      const decoded = jwt.verify(token, env.SESSION_SECRET, {
        algorithms: ['HS256'],
      }) as SessionPayload;

      if (!decoded.sub || !decoded.email) {
        return null;
      }

      return {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name,
        avatar: decoded.avatar,
      };
    } catch {
      return null;
    }
  }

  /**
   * Standard cookie options for the session cookie.
   */
  public static getSessionCookieOptions() {
    const isProduction = env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      maxAge: this.SESSION_MAX_AGE_MS,
      path: '/',
    };
  }

  /**
   * Standard cookie options for the temporary CSRF state cookie.
   */
  public static getStateCookieOptions() {
    const isProduction = env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      maxAge: 10 * 60 * 1000, // 10 minutes
      path: '/',
    };
  }
}
