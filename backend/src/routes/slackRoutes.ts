import { Router } from 'express';
import { SlackController } from '../controllers/slackController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// OAuth initiation: GET /api/slack/authorize (or /api/auth/slack)
router.get('/authorize', SlackController.initiateSlackAuth);

// OAuth callback: GET /api/slack/callback (or /api/auth/slack/callback)
router.get('/callback', SlackController.handleSlackCallback);

// Status check: GET /api/slack/status
router.get('/status', SlackController.getSlackStatus);

// Disconnect: POST /api/slack/disconnect
router.post('/disconnect', requireAuth, SlackController.disconnectSlack);

// Test notification: POST /api/slack/test-notification
router.post('/test-notification', requireAuth, SlackController.sendTestNotification);

export const slackRoutes = router;
