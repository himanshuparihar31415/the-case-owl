import { Router } from 'express';
import { getReport, regenerateReport, getIdealTranscript } from './report.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { aiLimiter, generalLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

router.get('/:sessionId', requireAuth, generalLimiter, getReport);
router.post('/:sessionId/regenerate', requireAuth, aiLimiter, regenerateReport);
router.post('/:sessionId/ideal-transcript', requireAuth, aiLimiter, getIdealTranscript);

export default router;
