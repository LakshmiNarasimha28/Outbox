import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { AuthService, AuthUser } from '../services/authService';
import { resolveFrontendUrl, resolveGoogleCallbackUrl, env } from '../config/env';
import { closeDatabasePool } from '../database/mysql';
import { closeRedisConnection } from '../queue/redis';
import { closeEmailQueue } from '../queue/emailQueue';

/**
 * Creates a mock Google OAuth2Client for isolated unit/integration testing.
 */
function createMockOAuthClient() {
  return {
    generateAuthUrl: (options: { state: string; redirect_uri?: string }) => {
      const redirectUriParam = options.redirect_uri
        ? `&redirect_uri=${encodeURIComponent(options.redirect_uri)}`
        : '';
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=mock-client-id&state=${options.state}&scope=openid+profile+email${redirectUriParam}`;
    },
    getToken: async (code: string) => {
      if (code === 'valid-auth-code') {
        return {
          tokens: {
            id_token: 'mock-valid-id-token',
            access_token: 'mock-access-token',
            expiry_date: Date.now() + 3600000,
          },
        };
      }
      throw new Error('invalid_grant: Code is expired or invalid');
    },
    setCredentials: (_tokens: any) => {},
    verifyIdToken: async ({ idToken }: { idToken: string }) => {
      if (idToken === 'mock-valid-id-token') {
        return {
          getPayload: () => ({
            sub: 'google-user-id-998877',
            email: 'engineer@outbox.labs',
            name: 'Outbox Engineer',
            picture: 'https://lh3.googleusercontent.com/photo.jpg',
          }),
        };
      }
      throw new Error('Invalid token signature');
    },
  };
}

describe('Google OAuth 2.0 Authentication & Session Lifecycle Tests', () => {
  const app = createApp();

  after(async () => {
    AuthService.setOAuthClient(null);
    await closeEmailQueue();
    await closeRedisConnection();
    await closeDatabasePool();
  });

  beforeEach(() => {
    AuthService.setOAuthClient(null);
  });

  it('should return 503 when Google OAuth is not configured in environment', async () => {
    // When no client or env credentials exist
    AuthService.setOAuthClient(null);

    const res = await request(app).get('/api/auth/google');
    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('Google OAuth is not configured'));
  });

  it('should return unauthenticated status from GET /api/auth/me when no session cookie exists', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.user, null);
  });

  it('should initiate OAuth login, generate CSRF state, and set oauth_state cookie', async () => {
    const mockClient = createMockOAuthClient();
    AuthService.setOAuthClient(mockClient as any);

    const res = await request(app).get('/api/auth/google');
    assert.equal(res.status, 302);
    assert.ok(res.headers.location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    assert.ok(res.headers.location.includes('state='));

    // Verify CSRF state cookie was set
    const setCookie = ([].concat(res.headers['set-cookie'] as any)) as string[];
    assert.ok(setCookie.length > 0);
    const hasStateCookie = setCookie.some((c: string) => c.includes(AuthService.STATE_COOKIE_NAME));
    assert.ok(hasStateCookie, 'Must set oauth_state cookie');
  });

  it('should handle cancelled consent in OAuth callback gracefully without crashing', async () => {
    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ error: 'access_denied', error_description: 'User denied consent' });

    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('auth_error=User%20denied%20consent'));
  });

  it('should reject callback with invalid or mismatched CSRF state', async () => {
    const mockClient = createMockOAuthClient();
    AuthService.setOAuthClient(mockClient as any);

    const res = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'valid-auth-code', state: 'untrusted-state-123' })
      .set('Cookie', [`${AuthService.STATE_COOKIE_NAME}=legitimate-state-456`]);

    assert.equal(res.status, 302);
    assert.ok(res.headers.location.includes('auth_error=Invalid'));
  });

  it('should exchange valid code for tokens, issue session cookie, and restore session in GET /api/auth/me', async () => {
    const mockClient = createMockOAuthClient();
    AuthService.setOAuthClient(mockClient as any);

    const testState = 'valid-csrf-state-abc';

    // 1. Process successful callback
    const callbackRes = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'valid-auth-code', state: testState })
      .set('Cookie', [`${AuthService.STATE_COOKIE_NAME}=${testState}`]);

    assert.equal(callbackRes.status, 302);
    assert.ok(callbackRes.headers.location.includes('auth_success=true'));

    // Extract session cookie
    const cookies = ([].concat(callbackRes.headers['set-cookie'] as any)) as string[];
    assert.ok(cookies.length > 0);
    const sessionCookie = cookies.find((c: string) => c.startsWith(`${AuthService.SESSION_COOKIE_NAME}=`));
    assert.ok(sessionCookie, 'Must set outbox_session cookie');

    // 2. Call GET /api/auth/me using the session cookie
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', [sessionCookie]);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.success, true);
    assert.equal(meRes.body.authenticated, true);
    assert.equal(meRes.body.user.id, 'google-user-id-998877');
    assert.equal(meRes.body.user.email, 'engineer@outbox.labs');
    assert.equal(meRes.body.user.name, 'Outbox Engineer');
    assert.equal(meRes.body.user.avatar, 'https://lh3.googleusercontent.com/photo.jpg');

    // 3. Test logout: POST /api/auth/logout should clear session
    const logoutRes = await request(app).post('/api/auth/logout');
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.success, true);

    const postLogoutCookies = ([].concat(logoutRes.headers['set-cookie'] as any)) as string[];
    assert.ok(postLogoutCookies.length > 0);
    const clearedSession = postLogoutCookies.some((c: string) =>
      c.includes(`${AuthService.SESSION_COOKIE_NAME}=;`) || c.includes('Expires=Thu, 01 Jan 1970')
    );
    assert.ok(clearedSession, 'Must clear session cookie');
  });

  it('should reject unauthenticated access with 401 when OAuth is active', async () => {
    const mockClient = createMockOAuthClient();
    AuthService.setOAuthClient(mockClient as any);

    // Calling email endpoints without session cookie must return 401
    const res = await request(app).get('/api/emails');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Unauthorized');
  });

  it('should enforce data isolation between different authenticated users', async () => {
    const mockClient = createMockOAuthClient();
    AuthService.setOAuthClient(mockClient as any);

    // Create session token for User A
    const userA: AuthUser = {
      id: 'google-user-a',
      email: 'usera@example.com',
      name: 'User A',
      avatar: null,
    };
    const tokenA = AuthService.signSessionToken(userA);

    // Create session token for User B
    const userB: AuthUser = {
      id: 'google-user-b',
      email: 'userb@example.com',
      name: 'User B',
      avatar: null,
    };
    const tokenB = AuthService.signSessionToken(userB);

    // 1. User A schedules an email
    const scheduleRes = await request(app)
      .post('/api/emails/schedule')
      .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${tokenA}`])
      .send({
        recipient: 'recipient-a@example.com',
        subject: 'Confidential Email for User A',
        body: 'Private financial records for User A only.',
        scheduledAt: new Date().toISOString(),
      });

    assert.equal(scheduleRes.status, 201);
    const emailA = scheduleRes.body.email;
    assert.ok(emailA.id);

    // 2. User A can retrieve their own email
    const getResA = await request(app)
      .get(`/api/emails/${emailA.id}`)
      .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${tokenA}`]);

    assert.equal(getResA.status, 200);
    assert.equal(getResA.body.email.id, emailA.id);

    // 3. User B attempts to access User A's email -> must return 404 Not Found (Data Isolation)
    const getResB = await request(app)
      .get(`/api/emails/${emailA.id}`)
      .set('Cookie', [`${AuthService.SESSION_COOKIE_NAME}=${tokenB}`]);

    assert.equal(getResB.status, 404, 'User B must not be able to view User A private email');
  });

  describe('Google OAuth Production Redirects & URL Resolution', () => {
    it('should use Vercel production origin for post-login redirect when proxied from Vercel', async () => {
      const mockClient = createMockOAuthClient();
      AuthService.setOAuthClient(mockClient as any);

      const testState = 'production-csrf-state-xyz';

      const callbackRes = await request(app)
        .get('/api/auth/google/callback')
        .query({ code: 'valid-auth-code', state: testState })
        .set('Cookie', [`${AuthService.STATE_COOKIE_NAME}=${testState}`])
        .set('X-Forwarded-Host', 'outbox-black.vercel.app')
        .set('X-Forwarded-Proto', 'https');

      assert.equal(callbackRes.status, 302);
      assert.equal(callbackRes.headers.location, 'https://outbox-black.vercel.app/?auth_success=true');
    });

    it('should pass Vercel production callback URI to Google when initiated via Vercel proxy', async () => {
      const mockClient = createMockOAuthClient();
      AuthService.setOAuthClient(mockClient as any);

      const res = await request(app)
        .get('/api/auth/google')
        .set('X-Forwarded-Host', 'outbox-black.vercel.app')
        .set('X-Forwarded-Proto', 'https');

      assert.equal(res.status, 302);
      assert.ok(
        res.headers.location.includes(
          'redirect_uri=' + encodeURIComponent('https://outbox-black.vercel.app/api/auth/google/callback')
        )
      );
    });

    it('should preserve localhost callback and redirect in development mode without proxy headers', async () => {
      const mockClient = createMockOAuthClient();
      AuthService.setOAuthClient(mockClient as any);

      const testState = 'dev-csrf-state-123';

      const callbackRes = await request(app)
        .get('/api/auth/google/callback')
        .query({ code: 'valid-auth-code', state: testState })
        .set('Cookie', [`${AuthService.STATE_COOKIE_NAME}=${testState}`]);

      assert.equal(callbackRes.status, 302);
      // In development mode, redirects to localhost:5173
      assert.ok(callbackRes.headers.location.startsWith('http://localhost:5173/?auth_success=true'));
    });

    it('resolveFrontendUrl resolves correctly in production vs development', () => {
      // Mock request from Vercel
      const reqFromVercel = {
        get: (h: string) => (h === 'x-forwarded-host' ? 'outbox-black.vercel.app' : h === 'x-forwarded-proto' ? 'https' : undefined),
      };
      assert.equal(resolveFrontendUrl(reqFromVercel), 'https://outbox-black.vercel.app');

      // Request directly hitting Render backend should NOT use onrender.com as frontend origin
      const reqDirectRender = {
        get: (h: string) => (h === 'x-forwarded-host' ? 'outbox-w6d7.onrender.com' : undefined),
      };
      assert.equal(
        resolveFrontendUrl(reqDirectRender),
        env.NODE_ENV === 'production' ? 'https://outbox-black.vercel.app' : 'http://localhost:5173'
      );
    });

    it('resolveGoogleCallbackUrl resolves to Vercel callback URL in production', () => {
      const reqFromVercel = {
        get: (h: string) => (h === 'x-forwarded-host' ? 'outbox-black.vercel.app' : h === 'x-forwarded-proto' ? 'https' : undefined),
      };
      assert.equal(
        resolveGoogleCallbackUrl(reqFromVercel),
        'https://outbox-black.vercel.app/api/auth/google/callback'
      );
    });

    it('respects FRONTEND_URL or APP_URL when configured', () => {
      const originalFrontendUrl = env.FRONTEND_URL;
      const originalAppUrl = env.APP_URL;

      try {
        (env as any).FRONTEND_URL = 'https://custom-outbox.org';
        assert.equal(resolveFrontendUrl(), 'https://custom-outbox.org');

        (env as any).FRONTEND_URL = undefined;
        (env as any).APP_URL = 'https://app-outbox.org';
        assert.equal(resolveFrontendUrl(), 'https://app-outbox.org');
      } finally {
        (env as any).FRONTEND_URL = originalFrontendUrl;
        (env as any).APP_URL = originalAppUrl;
      }
    });

    it('replaces localhost callback with production callback when in production mode', () => {
      const originalNodeEnv = env.NODE_ENV;
      const originalCallback = process.env.GOOGLE_CALLBACK_URL;

      try {
        (env as any).NODE_ENV = 'production';
        process.env.GOOGLE_CALLBACK_URL = 'http://localhost:5000/api/auth/google/callback';

        // When GOOGLE_CALLBACK_URL was mistakenly set to localhost in production:
        assert.equal(
          resolveGoogleCallbackUrl(),
          'https://outbox-black.vercel.app/api/auth/google/callback'
        );
      } finally {
        (env as any).NODE_ENV = originalNodeEnv;
        if (originalCallback !== undefined) {
          process.env.GOOGLE_CALLBACK_URL = originalCallback;
        } else {
          delete process.env.GOOGLE_CALLBACK_URL;
        }
      }
    });
  });
});
