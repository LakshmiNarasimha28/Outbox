import { Router, Request, Response } from 'express';
import { HealthService } from '../services/healthService';

const router = Router();

/**
 * @route   GET /health
 * @desc    Comprehensive health check including database, Redis, and integration connectivity
 * @access  Public
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const report = await HealthService.getHealthReport();
    const isStrict = req.query.strict === 'true';
    const httpStatus = isStrict && report.status !== 'ok' ? 503 : 200;
    res.status(httpStatus).json(report);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate health report',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @route   GET /health/live
 * @desc    Lightweight liveness probe for container orchestration
 * @access  Public
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json(HealthService.getLiveness());
});

/**
 * @route   GET /health/ready
 * @desc    Readiness probe distinguishing core readiness (MySQL, Redis) from optional integrations
 * @access  Public
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    const status = await HealthService.isReady();
    if (status.ready) {
      res.status(200).json({
        status: 'ready',
        ...status,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        ...status,
        message: 'Core service dependencies (MySQL or Redis) are not ready',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error instanceof Error ? error.message : 'Readiness check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

export const healthRoutes = router;
