import { Request, Response, NextFunction } from 'express';
import { AuthService, AuthUser } from '../services/authService';
import { env } from '../config/env';

// Extend Express Request declaration to include user object
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Middleware that inspects incoming cookies and authorization headers
 * to decode and attach the authenticated user to req.user.
 */
export function authenticateSession(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  // 1. Inspect session cookie or Bearer token
  const cookieToken =
    req.cookies?.[AuthService.SESSION_COOKIE_NAME] ||
    req.signedCookies?.[AuthService.SESSION_COOKIE_NAME];

  let token: string | undefined = cookieToken;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1];
    }
  }

  if (token) {
    const user = AuthService.verifySessionToken(token);
    if (user) {
      req.user = user;
    }
  }

  next();
}

/**
 * Middleware that strictly protects routes from unauthenticated access.
 * Returns 401 Unauthorized if the user is not authenticated.
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.user) {
    return next();
  }

  // If OAuth is configured or authentication is explicitly enforced, reject unauthenticated calls
  if (AuthService.isConfigured() || env.AUTH_ENFORCED) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Please sign in with Google.',
    });
    return;
  }

  // Graceful fallback for legacy test suites or unconfigured local environments
  req.user = {
    id: 'legacy-system-user',
    email: env.DEFAULT_SENDER,
    name: 'System User',
    avatar: null,
  };
  next();
}
