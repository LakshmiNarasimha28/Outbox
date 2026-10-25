import { Router, Request, Response } from 'express';
import { getQueueTelemetry } from '../queue/bullBoard';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

/**
 * GET /api/queues/stats
 * Returns live BullMQ queue counts and status for frontend telemetry.
 */
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  const telemetry = await getQueueTelemetry();
  res.json({
    success: true,
    ...telemetry,
  });
});

export const queueRoutes = router;
