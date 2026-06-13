import { Router } from 'express';
import { getPlans, getWallet, checkout, verify } from './billing.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';

const router = Router();

router.get('/plans', requireAuth, generalLimiter, getPlans);
router.get('/wallet', requireAuth, generalLimiter, getWallet);
router.post('/checkout', requireAuth, generalLimiter, checkout);
router.post('/verify', requireAuth, generalLimiter, verify);
// NOTE: POST /api/billing/webhook is mounted in server.ts with express.raw,
// before the JSON body parser, so the HMAC can be verified against the raw body.

export default router;
