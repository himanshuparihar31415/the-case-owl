import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { generalLimiter } from '../../middleware/rateLimiter.js';
import {
  getUserDetail, adjustCredits, setSuspended,
  listAllPlans, createPlanCtrl, updatePlanCtrl, getAudit,
  getSettingsCtrl, updateSettingsCtrl,
} from './admin.controller.js';

const router = Router();

// Every admin route is behind the role guard.
router.use(requireAuth, generalLimiter, requireAdmin);

router.get('/users/:id', getUserDetail);
router.post('/users/:id/credits', adjustCredits);
router.post('/users/:id/suspend', setSuspended);
router.get('/plans', listAllPlans);
router.post('/plans', createPlanCtrl);
router.patch('/plans/:code', updatePlanCtrl);
router.get('/audit', getAudit);
router.get('/settings', getSettingsCtrl);
router.patch('/settings', updateSettingsCtrl);

export default router;
