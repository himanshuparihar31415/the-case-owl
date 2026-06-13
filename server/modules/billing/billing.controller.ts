import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { listActivePlans, grossMinor } from './plans.service.js';
import { ensureWallet, spendable, getLedger } from './wallet.service.js';
import { createSubscriptionOrder, verifyAndFulfil, handleWebhook } from './billing.service.js';

export async function getPlans(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const plans = await listActivePlans();
    res.json({
      plans: plans.map((p) => ({
        code: p.code, family: p.family, name: p.name, currency: p.currency,
        priceMinor: p.priceMinor, gstPercent: p.gstPercent, grossMinor: grossMinor(p),
        interval: p.interval, credits: p.credits, unlimited: p.unlimited, perInterviewCapMinutes: p.perInterviewCapMinutes,
      })),
    });
  } catch (err) { next(err); }
}

export async function getWallet(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const wallet = await ensureWallet(req.userId!);
    const ledger = await getLedger(req.userId!, 50);
    res.json({
      wallet: {
        subscriptionCredits: wallet.subscriptionCredits, topupCredits: wallet.topupCredits,
        reserved: wallet.reserved, spendable: spendable(wallet), unlimited: wallet.unlimited,
        planCode: wallet.planCode, perInterviewCapMinutes: wallet.perInterviewCapMinutes,
        currency: wallet.currency, renewalAt: wallet.renewalAt,
      },
      ledger,
    });
  } catch (err) { next(err); }
}

export async function checkout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { planCode } = req.body as { planCode?: string };
    if (!planCode) throw new AppError(400, 'planCode is required');
    const order = await createSubscriptionOrder(req.userId!, planCode);
    res.json(order);
  } catch (err) { next(err); }
}

export async function verify(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orderId, paymentId, signature } = req.body as { orderId?: string; paymentId?: string; signature?: string };
    if (!orderId || !paymentId || !signature) throw new AppError(400, 'orderId, paymentId, signature required');
    await verifyAndFulfil(orderId, paymentId, signature);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

// Mounted with express.raw in server.ts (must see the raw body to verify HMAC).
export async function webhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    if (!signature) { res.status(400).json({ error: 'missing signature' }); return; }
    await handleWebhook(req.body as Buffer, signature);
    res.json({ ok: true });
  } catch (err) {
    // Always 2xx-or-4xx fast; log and don't leak internals. Razorpay retries on non-2xx.
    const status = (err as AppError).statusCode ?? 400;
    console.error('Razorpay webhook error:', (err as Error).message);
    res.status(status).json({ error: 'webhook rejected' });
  }
}
