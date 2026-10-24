import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'express';
import corsMiddleware from 'cors';
import { env } from './config/env';
import { apiRouter } from './routes';
import { healthRoutes } from './routes/healthRoutes';

export function createApp(): Express {
  const app = express();

  // CORS configuration
  app.use(
    corsMiddleware({
      origin: [env.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    })
  );

  // Body parser middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

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

  // Fallback 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      availableEndpoints: ['/health', '/health/live', '/api/health'],
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
