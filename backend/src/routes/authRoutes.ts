import { Router } from 'express';
import { AuthController } from '../controllers/authController';

const router = Router();

// Google OAuth initiation
router.get('/google', AuthController.initiateGoogleAuth);

// Google OAuth callback
router.get('/google/callback', AuthController.handleGoogleCallback);

// Current user profile & authentication status
router.get('/me', AuthController.getMe);

// Logout session
router.post('/logout', AuthController.logout);

export const authRoutes = router;
