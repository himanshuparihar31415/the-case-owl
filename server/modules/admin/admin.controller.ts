import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { User } from '../../models/User.js';
import { AuditLog } from '../../models/AuditLog.js';
import { ensureWallet, spendable, grantCredits, getLedger } from '../billing/wallet.service.js';
import { createPlan, updatePlan, listActivePlans } from '../billing/plans.service.js';
import { Plan } from '../../models/Plan.js';
import { Setting, getSettings } from '../../models/Setting.js';

async function audit(adminId: string, action: string, targetUserId: string | undefined, details: Record<string, unknown>) {
  await AuditLog.create({ adminId, action, targetUserId, details });
}

// GET /admin/users/:id — full picture: profile + wallet + recent ledger.
export async function getUserDetail(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) throw new AppError(404, 'User not found');
    const wallet = await ensureWallet(req.params.id);
    const ledger = await getLedger(req.params.id, 100);
    res.json({ user, wallet: { ...wallet.toObject(), spendable: spendable(wallet) }, ledger });
  } catch (err) { next(err); }
}

// POST /admin/users/:id/credits — manual grant/deduct (support, refunds, promos).
export async function adjustCredits(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { amount, reason, bucket } = req.body as { amount?: number; reason?: string; bucket?: 'subscription' | 'topup' };
    if (typeof amount !== 'number' || amount === 0) throw new AppError(400, 'amount (non-zero number) required');
    const targetId = req.params.id;
    // Manual grants get a unique idempotency key so an accidental double-submit can't double-apply within the same second.
    const key = `admin:${req.userId}:${targetId}:${amount}:${Date.now()}`;
    await grantCredits({
      userId: targetId, type: 'admin_grant', amount, idempotencyKey: key,
      reason: reason ?? 'admin adjustment', adminId: req.userId, bucket: bucket ?? 'subscription',
    });
    await audit(req.userId!, amount > 0 ? 'grant_credits' : 'deduct_credits', targetId, { amount, reason, bucket });
    const wallet = await ensureWallet(targetId);
    res.json({ wallet: { ...wallet.toObject(), spendable: spendable(wallet) } });
  } catch (err) { next(err); }
}

// POST /admin/users/:id/suspend  { suspended: boolean }
export async function setSuspended(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { suspended } = req.body as { suspended?: boolean };
    const user = await User.findByIdAndUpdate(req.params.id, { suspended: !!suspended }, { new: true }).select('-passwordHash');
    if (!user) throw new AppError(404, 'User not found');
    await audit(req.userId!, suspended ? 'suspend_user' : 'unsuspend_user', req.params.id, {});
    res.json({ user });
  } catch (err) { next(err); }
}

// Plans
export async function listAllPlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ plans: await Plan.find().sort({ family: 1, priceMinor: 1 }) }); } catch (err) { next(err); }
}
export async function createPlanCtrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = await createPlan(req.body);
    await audit(req.userId!, 'create_plan', undefined, { code: plan.code });
    res.status(201).json({ plan });
  } catch (err) { next(err); }
}
export async function updatePlanCtrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plan = await updatePlan(req.params.code, req.body);
    if (!plan) throw new AppError(404, 'Plan not found');
    await audit(req.userId!, 'edit_plan', undefined, { code: plan.code, changes: req.body });
    res.json({ plan });
  } catch (err) { next(err); }
}

// GET /admin/audit
export async function getAudit(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ audit: await AuditLog.find().sort({ createdAt: -1 }).limit(200).populate('adminId targetUserId', 'name email') }); } catch (err) { next(err); }
}

// Reference: surfaced so the admin UI can show the live catalogue.
export async function getActivePlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ plans: await listActivePlans() }); } catch (err) { next(err); }
}

// GET/PATCH /admin/settings — the editable global rules (e.g. free signup credits).
export async function getSettingsCtrl(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try { res.json({ settings: await getSettings() }); } catch (err) { next(err); }
}
export async function updateSettingsCtrl(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { signupPromoCredits, promoEnabled } = req.body as { signupPromoCredits?: number; promoEnabled?: boolean };
    const update: Record<string, unknown> = {};
    if (typeof signupPromoCredits === 'number') update.signupPromoCredits = signupPromoCredits;
    if (typeof promoEnabled === 'boolean') update.promoEnabled = promoEnabled;
    const settings = await Setting.findOneAndUpdate({ key: 'global' }, update, { new: true, upsert: true });
    await audit(req.userId!, 'edit_settings', undefined, update);
    res.json({ settings });
  } catch (err) { next(err); }
}
