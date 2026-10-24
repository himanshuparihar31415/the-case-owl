import { Wallet, IWallet } from '../../models/Wallet.js';
import { LedgerEntry, LedgerType } from '../../models/LedgerEntry.js';
import { IPlan } from '../../models/Plan.js';

/* Credits are minutes. Wallet = running total; LedgerEntry = append-only truth.
   Two non-negotiable guardrails live here: idempotent grants (unique
   idempotencyKey) and atomic balance check+deduct (conditional updates). */

export async function ensureWallet(userId: string): Promise<IWallet> {
  const existing = await Wallet.findOne({ userId });
  if (existing) return existing;
  return Wallet.create({ userId });
}

export function spendable(w: IWallet): number {
  return Math.max(0, w.subscriptionCredits + w.topupCredits - w.reserved);
}

interface GrantOpts {
  userId: string;
  type: LedgerType;
  amount: number;
  idempotencyKey?: string;     // required for payment-driven grants
  reason?: string;
  paymentId?: string;
  adminId?: string;
  bucket?: 'subscription' | 'topup';
}

// Idempotent grant: the ledger insert (unique idempotencyKey) is the gate, so a
// duplicate webhook can never double-credit. We insert FIRST, then increment.
export async function grantCredits(opts: GrantOpts): Promise<{ duplicate: boolean }> {
  const { userId, type, amount, idempotencyKey, reason, paymentId, adminId } = opts;
  const bucket = opts.bucket ?? 'subscription';

  if (idempotencyKey) {
    const existing = await LedgerEntry.findOne({ idempotencyKey });
    if (existing) return { duplicate: true };
  }

  let entry;
  try {
    entry = await LedgerEntry.create({ userId, type, amount, balanceAfter: -1, reason, paymentId, adminId, idempotencyKey });
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) return { duplicate: true }; // concurrent replay
    throw err;
  }

  const field = bucket === 'topup' ? 'topupCredits' : 'subscriptionCredits';
  const wallet = await Wallet.findOneAndUpdate({ userId }, { $inc: { [field]: amount } }, { new: true, upsert: true });
  entry.balanceAfter = wallet ? wallet.subscriptionCredits + wallet.topupCredits : amount;
  await entry.save();
  return { duplicate: false };
}

// Hold estimated minutes for an in-flight session. Atomic: only succeeds if the
// wallet actually has the headroom, so concurrent sessions can't overspend.
// Returns the minutes actually held (0 = can't start).
export async function reserve(userId: string, capMinutes: number): Promise<number> {
  const wallet = await ensureWallet(userId);

  if (wallet.unlimited) {
    await Wallet.updateOne({ userId }, { $inc: { reserved: capMinutes } });
    await LedgerEntry.create({ userId, type: 'reserve', amount: 0, balanceAfter: wallet.subscriptionCredits + wallet.topupCredits, reason: `reserve ${capMinutes}m (unlimited)` });
    return capMinutes;
  }

  const avail = wallet.subscriptionCredits + wallet.topupCredits - wallet.reserved;
  const hold = Math.min(capMinutes, Math.max(0, avail));
  if (hold <= 0) return 0;

  const ok = await Wallet.findOneAndUpdate(
    { userId, $expr: { $gte: [{ $subtract: [{ $add: ['$subscriptionCredits', '$topupCredits'] }, '$reserved'] }, hold] } },
    { $inc: { reserved: hold } },
    { new: true }
  );
  if (!ok) return 0; // lost a race; caller rejects
  await LedgerEntry.create({ userId, type: 'reserve', amount: 0, balanceAfter: ok.subscriptionCredits + ok.topupCredits, reason: `reserve ${hold}m` });
  return hold;
}

// Release a held reservation (clamped at 0).
export async function release(userId: string, minutes: number): Promise<void> {
  if (minutes <= 0) return;
  // An update pipeline (to clamp at 0): Mongoose 9 refuses one unless `updatePipeline` is set, and
  // without it every settle threw here and the hold was never released.
  await Wallet.findOneAndUpdate({ userId }, [
    { $set: { reserved: { $max: [0, { $subtract: ['$reserved', minutes] }] } } },
  ], { updatePipeline: true });
}

// Actually spend minutes (at settle). Deducts subscription first, then top-up.
// Never goes negative.
export async function consume(userId: string, minutes: number, sessionId?: string): Promise<void> {
  if (minutes <= 0) return;
  const wallet = await ensureWallet(userId);

  if (wallet.unlimited) {
    await LedgerEntry.create({ userId, type: 'consume', amount: -minutes, balanceAfter: wallet.subscriptionCredits + wallet.topupCredits, sessionId, reason: `consume ${minutes}m (unlimited)` });
    return;
  }

  const fromSub = Math.min(wallet.subscriptionCredits, minutes);
  const fromTop = Math.min(wallet.topupCredits, minutes - fromSub);
  await Wallet.updateOne({ userId }, { $inc: { subscriptionCredits: -fromSub, topupCredits: -fromTop } });
  const balanceAfter = (wallet.subscriptionCredits - fromSub) + (wallet.topupCredits - fromTop);
  await LedgerEntry.create({ userId, type: 'consume', amount: -(fromSub + fromTop), balanceAfter, sessionId, reason: `consume ${minutes}m` });
}

// Settle a finished session: spend the actual minutes, release the held estimate.
export async function settle(userId: string, sessionId: string, actualMinutes: number, reservedMinutes: number): Promise<void> {
  await consume(userId, actualMinutes, sessionId);
  await release(userId, reservedMinutes);
}

// Copy plan terms onto the wallet and grant the cycle's credits (idempotent on
// the payment id). We COPY — we never read the plan live during sessions.
export async function subscribeToPlan(userId: string, plan: IPlan, paymentId: string): Promise<void> {
  const wallet = await ensureWallet(userId);
  const renewalAt = new Date();
  if (plan.interval === '2week') renewalAt.setDate(renewalAt.getDate() + 14);
  else renewalAt.setMonth(renewalAt.getMonth() + 1);

  wallet.unlimited = plan.unlimited;
  wallet.perInterviewCapMinutes = plan.perInterviewCapMinutes;
  wallet.planCode = plan.code;
  wallet.currency = plan.currency;
  wallet.renewalAt = renewalAt;
  if (!plan.rollover) wallet.subscriptionCredits = 0; // reset; grant below re-fills
  await wallet.save();

  await grantCredits({
    userId, type: 'subscription_grant', amount: plan.credits,
    idempotencyKey: paymentId, paymentId, reason: `subscribe ${plan.code}`, bucket: 'subscription',
  });
}

// Reverse a refund: pull back the credits that the payment granted.
export async function reverseGrant(userId: string, paymentId: string, amount: number, adminId?: string): Promise<void> {
  await grantCredits({
    userId, type: 'refund_reversal', amount: -Math.abs(amount),
    idempotencyKey: `refund:${paymentId}`, paymentId, adminId, reason: `refund reversal for ${paymentId}`, bucket: 'subscription',
  });
}

export function secondsToMinutes(seconds: number): number {
  return Math.ceil(Math.max(0, seconds) / 60);
}

export async function getLedger(userId: string, limit = 50) {
  return LedgerEntry.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}
