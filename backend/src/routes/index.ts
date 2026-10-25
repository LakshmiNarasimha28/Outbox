import { Router } from 'express';
import { healthRoutes } from './healthRoutes';
import { emailRoutes } from './emailRoutes';
import { authRoutes } from './authRoutes';
import { slackRoutes } from './slackRoutes';

const router = Router();

// Mount sub-routers
router.use('/health', healthRoutes);
router.use('/emails', emailRoutes);
router.use('/auth', authRoutes);
router.use('/slack', slackRoutes);

// Also mount /auth/slack aliases for convenient callback routing
router.get('/auth/slack', (req, res, next) => {
  req.url = '/authorize';
  slackRoutes(req, res, next);
});
router.get('/auth/slack/callback', (req, res, next) => {
  req.url = '/callback';
  slackRoutes(req, res, next);
});

export const apiRouter = router;
