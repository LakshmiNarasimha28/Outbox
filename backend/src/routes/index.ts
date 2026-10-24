import { Router } from 'express';
import { healthRoutes } from './healthRoutes';
import { emailRoutes } from './emailRoutes';

const router = Router();

// Mount sub-routers
router.use('/health', healthRoutes);
router.use('/emails', emailRoutes);

export const apiRouter = router;
