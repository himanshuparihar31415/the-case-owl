import crypto from 'crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/errorHandler.js';
import { PaymentIntent } from '../../models/PaymentIntent.js';
import { getPlanByCode, grossMinor } from './plans.service.js';
import { subscribeToPlan } from './wallet.service.js';

let client: Razorpay | null = null;
function razorpay(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError(503, 'Payments are not configured');
  }
  if (!client) client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return client;
}

// Create a Razorpay order for a subscription plan and record the intent.
export async function createSubscriptionOrder(userId: string, planCode: string) {
  const plan = await getPlanByCode(planCode);
  if (!plan || !plan.active) throw new AppError(404, 'Plan not found');

  const amount = grossMinor(plan); // paise, GST-inclusive
  const order = await razorpay().orders.create({
    amount, currency: plan.currency, notes: { userId, planCode, kind: 'subscription' },
  });

  await PaymentIntent.create({
    orderId: order.id, userId, kind: 'subscription', planCode, amountMinor: amount, currency: plan.currency, status: 'created',
  });

  return { orderId: order.id, amount, currency: plan.currency, keyId: env.RAZORPAY_KEY_ID, planName: plan.name };
}

// Fulfil a paid order. Idempotent: the subscribe grant is keyed on paymentId,
// and the intent flips to 'paid' once.
async function fulfil(orderId: string, paymentId: string): Promise<void> {
  const intent = await PaymentIntent.findOne({ orderId });
  if (!intent) {
    console.error('fulfil: no intent for order', orderId);
    return;
  }
  if (intent.status === 'paid') return; // already done

  if (intent.kind === 'subscription' && intent.planCode) {
    const plan = await getPlanByCode(intent.planCode);
    if (!plan) throw new AppError(404, 'Plan vanished');
    await subscribeToPlan(intent.userId.toString(), plan, paymentId);
  }
  // (top-up kind would grant topup credits here)

  intent.status = 'paid';
  intent.paymentId = paymentId;
  await intent.save();
}

// Verify the client-side checkout callback signature: HMAC_SHA256(order|payment).
export async function verifyAndFulfil(orderId: string, paymentId: string, signature: string): Promise<void> {
  if (!env.RAZORPAY_KEY_SECRET) throw new AppError(503, 'Payments not configured');
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  if (!safeEqual(expected, signature)) throw new AppError(400, 'Invalid payment signature');
  await fulfil(orderId, paymentId);
}

// Verify a webhook (HMAC of the raw body with the webhook secret) and process it.
export async function handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new AppError(503, 'Webhook secret not configured');
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (!safeEqual(expected, signature)) throw new AppError(400, 'Invalid webhook signature');

  const event = JSON.parse(rawBody.toString());
  const payment = event?.payload?.payment?.entity;
  if (!payment) return;

  if (event.event === 'payment.captured') {
    await fulfil(payment.order_id, payment.id);
  } else if (event.event === 'payment.failed') {
    await PaymentIntent.findOneAndUpdate({ orderId: payment.order_id }, { status: 'failed', paymentId: payment.id });
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
