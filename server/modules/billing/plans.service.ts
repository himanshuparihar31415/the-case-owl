import { Plan, IPlan } from '../../models/Plan.js';

// Default catalogue (INR, paise, GST-exclusive base). Versioned codes: when you
// change pricing for paying users, create *_v2 rather than editing these.
const DEFAULT_PLANS = [
  { code: 'starter_v1', family: 'starter', name: 'Starter', priceMinor: 149900, interval: 'month' as const, credits: 150, unlimited: false, perInterviewCapMinutes: 30, rollover: false },
  { code: 'pro_v1', family: 'pro', name: 'Pro', priceMinor: 399900, interval: 'month' as const, credits: 0, unlimited: true, perInterviewCapMinutes: 30, rollover: false },
  { code: 'sprint_v1', family: 'sprint', name: 'Sprint', priceMinor: 649900, interval: '2week' as const, credits: 0, unlimited: true, perInterviewCapMinutes: 30, rollover: false },
];

// Idempotent: only inserts a plan code that doesn't exist yet. Safe to call on boot.
export async function seedPlans(): Promise<void> {
  for (const p of DEFAULT_PLANS) {
    await Plan.updateOne({ code: p.code }, { $setOnInsert: { ...p, currency: 'INR', gstPercent: 18, active: true } }, { upsert: true });
  }
}

export async function listActivePlans(): Promise<IPlan[]> {
  return Plan.find({ active: true }).sort({ priceMinor: 1 });
}

export async function getPlanByCode(code: string): Promise<IPlan | null> {
  return Plan.findOne({ code });
}

// GST-inclusive total in minor units (paise) — what the customer actually pays.
export function grossMinor(plan: IPlan): number {
  return Math.round(plan.priceMinor * (1 + plan.gstPercent / 100));
}

export async function createPlan(data: Partial<IPlan>): Promise<IPlan> {
  return Plan.create(data);
}

export async function updatePlan(code: string, data: Partial<IPlan>): Promise<IPlan | null> {
  return Plan.findOneAndUpdate({ code }, data, { new: true });
}
