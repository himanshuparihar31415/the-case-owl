import { api } from './api';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { Razorpay?: any }
}

interface CheckoutOrder { orderId: string; amount: number; currency: string; keyId: string; planName: string }

function loadScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

// Create an order on our backend, open Razorpay checkout, and verify the
// signature on success. The grant itself happens server-side (idempotent on the
// payment id, via /billing/verify and the webhook).
export async function startCheckout(
  planCode: string,
  user: { name?: string; email?: string },
  handlers: { onSuccess: () => void; onError: (msg: string) => void; onDismiss?: () => void },
): Promise<void> {
  if (!(await loadScript())) { handlers.onError('Could not load the payment SDK. Check your connection.'); return; }

  let order: CheckoutOrder;
  try {
    order = await api.post<CheckoutOrder>('/billing/checkout', { planCode });
  } catch (e) {
    handlers.onError(e instanceof Error ? e.message : 'Could not start checkout.');
    return;
  }

  const rzp = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency,
    name: 'The Case Owl',
    description: order.planName,
    order_id: order.orderId,
    prefill: { name: user.name, email: user.email },
    theme: { color: '#1BA6E1' },
    handler: async (resp: any) => {
      try {
        await api.post('/billing/verify', {
          orderId: resp.razorpay_order_id,
          paymentId: resp.razorpay_payment_id,
          signature: resp.razorpay_signature,
        });
        handlers.onSuccess();
      } catch (e) {
        handlers.onError(e instanceof Error ? e.message : 'Payment verification failed. If money was deducted, it will reflect shortly.');
      }
    },
    modal: { ondismiss: () => handlers.onDismiss?.() },
  });
  rzp.open();
}
