import { Router } from 'express';
import { getOverview, getTrends, getWeaknesses, getHistory, getDashboard } from './analytics.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

router.get('/overview', requireAuth, generalLimiter, getOverview);
router.get('/dashboard', requireAuth, generalLimiter, getDashboard);
router.get('/trends', requireAuth, generalLimiter, getTrends);
router.get('/weaknesses', requireAuth, generalLimiter, getWeaknesses);
router.get('/history', requireAuth, generalLimiter, getHistory);

export default router;
