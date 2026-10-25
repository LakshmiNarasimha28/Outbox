import { Router } from 'express';
import { EmailController } from '../controllers/emailController';
import { requireAuth } from '../middleware/authMiddleware';

const router = Router();

// Protect all email management endpoints with authentication middleware
router.use(requireAuth);

/**
 * @route   POST /api/emails/schedule
 * @desc    Schedule a new email job with BullMQ delayed queueing and MySQL persistence
 * @access  Public
 */
router.post('/schedule', EmailController.scheduleEmail);

/**
 * @route   POST /api/emails/parse-leads
 * @desc    Parse and validate CSV or plain-text leads with duplicate detection
 * @access  Public
 */
router.post('/parse-leads', EmailController.parseLeads);

/**
 * @route   POST /api/emails/schedule-batch
 * @desc    Schedule a batch of emails with staggered delays, persistence, and rate limiting
 * @access  Public
 */
router.post('/schedule-batch', EmailController.scheduleBatch);

/**
 * @route   POST /api/emails/recover-pending
 * @desc    Idempotently recover and enqueue PENDING email jobs from MySQL to BullMQ
 * @access  Public
 */
router.post('/recover-pending', EmailController.recoverPendingJobs);

/**
 * @route   GET /api/emails/scheduled
 * @desc    List pending and currently processing scheduled emails
 * @access  Public
 */
router.get('/scheduled', EmailController.listScheduledEmails);

/**
 * @route   GET /api/emails/history
 * @desc    List sent, failed, or cancelled email delivery history
 * @access  Public
 */
router.get('/history', EmailController.listEmailHistory);

/**
 * @route   GET /api/emails
 * @desc    List emails with optional status and recipient filters
 * @access  Public
 */
router.get('/', EmailController.listEmails);

/**
 * @route   GET /api/emails/rate-limit
 * @desc    Query sender rate limit usage and remaining quota
 * @access  Public
 */
router.get('/rate-limit', EmailController.getRateLimitStatus);

/**
 * @route   GET /api/emails/search
 * @desc    Full-text search and filtering across indexed email jobs via Elasticsearch
 * @access  Public
 */
router.get('/search', EmailController.searchEmails);

/**
 * @route   GET /api/emails/:id
 * @desc    Retrieve details and delivery status of a single email
 * @access  Public
 */
router.get('/:id', EmailController.getEmailById);

export const emailRoutes = router;
