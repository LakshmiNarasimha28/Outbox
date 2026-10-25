import express, { Express, Request, Response, NextFunction } from 'express';
import corsMiddleware from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import { apiRouter } from './routes';
import { healthRoutes } from './routes/healthRoutes';
import { authenticateSession } from './middleware/authMiddleware';
import { setupBullBoard } from './queue/bullBoard';

export function createApp(): Express {
  const app = express();

  // Configure Express trusted proxy behavior safely for reverse proxies (Render, Railway, Fly, Nginx, ALB)
  // Does not blindly trust arbitrary proxies; uses configured TRUST_PROXY or 1 hop in production
  if (env.TRUST_PROXY !== undefined) {
    app.set('trust proxy', env.TRUST_PROXY);
  } else if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // CORS configuration
  app.use(
    corsMiddleware({
      origin: [env.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );

  // Body parser & cookie parser middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser(env.SESSION_SECRET));

  // Authenticate session on all incoming requests
  app.use(authenticateSession);

  // Request logger (safe: logs method, URL, and status; never logs headers, auth tokens, or passwords)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      // Filter out high-frequency live probes from noisy logging
      if (req.path !== '/health/live') {
        console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
      }
    });
    next();
  });

  // Health route directly at root level as well as /api
  app.use('/health', healthRoutes);
  app.use('/api', apiRouter);

  // Bull Board Live Queue Dashboard
  app.get('/admin', (_req: Request, res: Response) => res.redirect('/admin/queues'));
  setupBullBoard(app);

  // Serve compiled frontend assets and handle SPA routing in production
  const candidateFrontendPaths = [
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
  ];
  let frontendDistPath: string | null = null;
  for (const cand of candidateFrontendPaths) {
    if (fs.existsSync(cand)) {
      frontendDistPath = cand;
      break;
    }
  }

  if (frontendDistPath && (env.NODE_ENV === 'production' || process.env.SERVE_STATIC === 'true')) {
    app.use(express.static(frontendDistPath));

    // Client SPA fallback: serve index.html for GET requests that do not match API, health, or queue routes
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/health') ||
        req.path.startsWith('/admin')
      ) {
        return next();
      }
      res.sendFile(path.join(frontendDistPath!, 'index.html'));
    });
  }

  // Fallback 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      availableEndpoints: ['/health', '/health/live', '/health/ready', '/api/health'],
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Error]', err.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    });
  });

  return app;
}
