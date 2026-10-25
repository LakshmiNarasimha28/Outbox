import { Express, Request, Response, NextFunction } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getEmailQueue, EMAIL_QUEUE_NAME } from './emailQueue';
import { isRedisConfigured } from './redis';
import { AuthService } from '../services/authService';
import { env } from '../config/env';

let serverAdapterInstance: ExpressAdapter | null = null;
let boardInstance: ReturnType<typeof createBullBoard> | null = null;

/**
 * Middleware that secures the BullMQ dashboard against unauthenticated access.
 * If OAuth is configured or enforced, unauthenticated requests are rejected.
 */
export function requireQueueAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    return next();
  }

  if (AuthService.isConfigured() || env.AUTH_ENFORCED) {
    if (req.accepts('html')) {
      res.redirect(
        '/?auth_error=' +
          encodeURIComponent('Authentication required. Please sign in with Google to access the Queue Dashboard.')
      );
      return;
    }
    res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required. Please sign in with Google.',
    });
    return;
  }

  // Fallback for development/testing environments where OAuth is not configured
  req.user = {
    id: 'legacy-system-user',
    email: env.DEFAULT_SENDER,
    name: 'System User',
    avatar: null,
  };
  next();
}

/**
 * Initializes Bull Board with the existing BullMQ email-jobs queue.
 * Configured with readOnlyMode to prevent accidental destructive actions.
 */
export function setupBullBoard(app: Express): ExpressAdapter {
  if (serverAdapterInstance) {
    return serverAdapterInstance;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  serverAdapterInstance = serverAdapter;

  const queue = getEmailQueue();
  if (queue) {
    boardInstance = createBullBoard({
      queues: [
        new BullMQAdapter(queue, {
          readOnlyMode: true,
          allowRetries: true,
          description: 'Outbox Labs Distributed Email Jobs Queue',
          displayName: 'email-jobs',
        }),
      ],
      serverAdapter,
      options: {
        uiConfig: {
          boardTitle: 'Outbox Labs Queue Dashboard',
          hideDocsLink: true,
          miscLinks: [
            {
              text: '← Back to Outbox Scheduler',
              url: '/',
            },
          ],
        },
      },
    });
  }

  // Mount Bull Board with auth protection and graceful degradation
  app.use('/admin/queues', requireQueueAuth, (req: Request, res: Response, next: NextFunction) => {
    const currentQueue = getEmailQueue();
    if (!isRedisConfigured() || !currentQueue) {
      if (req.accepts('html')) {
        res.status(503).send(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Queue Dashboard Unavailable — Outbox Labs</title>
              <style>
                body {
                  background-color: #020617;
                  color: #f8fafc;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  padding: 1rem;
                }
                .card {
                  background: #0f172a;
                  border: 1px solid #1e293b;
                  border-radius: 1rem;
                  padding: 2.5rem;
                  max-width: 480px;
                  text-align: center;
                  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
                }
                h2 { color: #f43f5e; margin-top: 0; font-size: 1.25rem; }
                p { color: #94a3b8; font-size: 0.875rem; line-height: 1.6; }
                .btn {
                  display: inline-block;
                  margin-top: 1.25rem;
                  padding: 0.625rem 1.25rem;
                  background: #4f46e5;
                  color: #ffffff;
                  text-decoration: none;
                  border-radius: 0.5rem;
                  font-size: 0.875rem;
                  font-weight: 600;
                  transition: background 0.2s;
                }
                .btn:hover { background: #4338ca; }
              </style>
            </head>
            <body>
              <div class="card">
                <h2>Queue Dashboard Unavailable</h2>
                <p>The BullMQ Redis queue is not configured or currently unreachable. Please verify that <code>REDIS_URL</code> or <code>REDIS_HOST</code> in <code>backend/.env</code> is reachable.</p>
                <a href="/" class="btn">Return to Outbox Dashboard</a>
              </div>
            </body>
          </html>
        `);
        return;
      }

      res.status(503).json({
        success: false,
        error: 'QueueUnavailable',
        message: 'Redis queue is not configured or currently reachable.',
      });
      return;
    }

    serverAdapter.getRouter()(req, res, next);
  });

  return serverAdapter;
}

/**
 * Resets Bull Board singleton references for test isolation.
 */
export function resetBullBoard(): void {
  serverAdapterInstance = null;
  boardInstance = null;
}

/**
 * Helper to fetch live BullMQ telemetry for API consumers.
 */
export async function getQueueTelemetry() {
  const queue = getEmailQueue();
  if (!queue || !isRedisConfigured()) {
    return {
      available: false,
      queueName: EMAIL_QUEUE_NAME,
      counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
      isPaused: false,
      dashboardUrl: '/admin/queues',
    };
  }

  try {
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    );
    const isPaused = await queue.isPaused();

    return {
      available: true,
      queueName: EMAIL_QUEUE_NAME,
      counts,
      isPaused,
      dashboardUrl: '/admin/queues',
    };
  } catch (err: any) {
    return {
      available: false,
      error: err.message || 'Failed to query BullMQ queue telemetry',
      queueName: EMAIL_QUEUE_NAME,
      counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
      isPaused: false,
      dashboardUrl: '/admin/queues',
    };
  }
}
