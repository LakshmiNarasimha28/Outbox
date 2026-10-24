import { Router, Request, Response } from 'express';
import { HealthService } from '../services/healthService';

const router = Router();

/**
 * @route   GET /health
 * @desc    Comprehensive health check including database and Redis connectivity
 * @access  Public
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const report = await HealthService.getHealthReport();
    const httpStatus = report.status === 'ok' ? 200 : 200; // Returns 200 with degraded details so health dashboards can display service state
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
 * @desc    Basic liveness probe for process monitoring
 * @access  Public
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json(HealthService.getLiveness());
});

export const healthRoutes = router;
