import { Router } from 'express';
import { getLessonIndex, getLesson, recordView, getLoop } from './coaching.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

router.get('/lessons', requireAuth, generalLimiter, getLessonIndex);
router.get('/lessons/:habitTag', requireAuth, generalLimiter, getLesson);
router.post('/viewed', requireAuth, generalLimiter, recordView);
router.get('/loop/:sessionId', requireAuth, generalLimiter, getLoop);

export default router;
