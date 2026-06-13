import React, { useEffect, useState, useCallback } from 'react';
import { Check, Loader2, Wallet as WalletIcon, Sparkles, Infinity as InfinityIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/lib/api';
import { startCheckout } from '@/src/lib/razorpay';

interface AuthUser { name: string; email: string }

interface Plan {
  code: string; family: string; name: string; currency: string;
  priceMinor: number; gstPercent: number; grossMinor: number;
  interval: 'month' | '2week'; credits: number; unlimited: boolean; perInterviewCapMinutes: number;
}
interface WalletData {
  subscriptionCredits: number; topupCredits: number; reserved: number; spendable: number;
  unlimited: boolean; planCode: string | null; perInterviewCapMinutes: number; currency: string; renewalAt: string | null;
}
interface LedgerRow { _id: string; type: string; amount: number; balanceAfter: number; reason?: string; createdAt: string }

const inr = (minor: number) => '₹' + (minor / 100).toLocaleString('en-IN');
const FAMILY_BLURB: Record<string, string> = {
  starter: 'Find your gaps before committing a season.',
  pro: 'Unlimited reps for an active interview season.',
  sprint: 'Two intense weeks before interview day.',
};

export default function Billing({ user }: { user: AuthUser | null }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadWallet = useCallback(() => {
    return api.get<{ wallet: WalletData; ledger: LedgerRow[] }>('/billing/wallet')
      .then((d) => { setWallet(d.wallet); setLedger(d.ledger); });
  }, []);

  useEffect(() => {
    Promise.all([
      api.get<{ plans: Plan[] }>('/billing/plans').then((d) => setPlans(d.plans)),
      loadWallet(),
    ]).catch(() => setMsg({ kind: 'err', text: 'Could not load billing data.' }))
      .finally(() => setLoading(false));
  }, [loadWallet]);

  const buy = (plan: Plan) => {
    setMsg(null);
    setBusy(plan.code);
    startCheckout(plan.code, { name: user?.name, email: user?.email }, {
      onSuccess: async () => { await loadWallet(); setBusy(null); setMsg({ kind: 'ok', text: `You're on ${plan.name}. Credits added — go practise.` }); },
      onError: (text) => { setBusy(null); if (text) setMsg({ kind: 'err', text }); },
      onDismiss: () => setBusy(null),
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>;
  }

  return (
    <div className="space-y-12 py-4">
      <header>
        <span className="label-blueprint text-on-tertiary-container font-bold block mb-2">Billing &amp; Credits</span>
        <h1 className="power-gap-h1 text-primary">Reps &amp; receipts.</h1>
      </header>

      {msg && (
        <div className={cn('rounded-lg px-4 py-3 text-sm font-medium', msg.kind === 'ok' ? 'bg-green-100 text-green-800' : 'bg-error-container/60 text-error')}>
          {msg.text}
        </div>
      )}

      {/* Wallet */}
      <section className="no-line-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-on-tertiary-container"><WalletIcon className="w-6 h-6" /></div>
          <div>
            <div className="label-blueprint">Your balance</div>
            <div className="font-headline font-extrabold text-2xl text-primary flex items-center gap-2">
              {wallet?.unlimited ? <><InfinityIcon className="w-6 h-6" /> Unlimited</> : <>{wallet?.spendable ?? 0} <span className="text-base text-secondary font-bold">credit-minutes</span></>}
            </div>
          </div>
        </div>
        <div className="text-sm text-secondary">
          <div>Plan: <b className="text-primary">{wallet?.planCode ?? 'None'}</b></div>
          <div>Per-interview cap: <b className="text-primary">{wallet?.perInterviewCapMinutes ?? 30} min</b></div>
          {wallet?.renewalAt && <div>Renews: {new Date(wallet.renewalAt).toLocaleDateString()}</div>}
        </div>
      </section>

      {/* Plans */}
      <section>
        <h2 className="font-headline font-bold text-xl text-primary mb-5">Choose your reps</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {plans.map((p) => {
            const current = wallet?.planCode === p.code;
            const featured = p.family === 'pro';
            return (
              <div key={p.code} className={cn('rounded-2xl p-6 border flex flex-col', featured ? 'border-on-tertiary-container shadow-lg' : 'border-outline-variant/15 bg-surface-container-lowest')}>
                {featured && <div className="label-blueprint text-on-tertiary-container mb-1 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Most reps</div>}
                <h3 className="font-headline font-bold text-lg text-primary">{p.name}</h3>
                <p className="text-[13px] text-secondary min-h-[38px] mt-1">{FAMILY_BLURB[p.family] ?? ''}</p>
                <div className="font-headline font-extrabold text-3xl text-primary mt-3">
                  {inr(p.priceMinor)}<span className="text-sm text-secondary font-medium">/{p.interval === '2week' ? '2wk' : 'mo'}</span>
                </div>
                <div className="text-[11px] text-secondary mb-4">+{p.gstPercent}% GST · {inr(p.grossMinor)} total</div>
                <ul className="space-y-2 text-[13px] text-on-surface-variant flex-grow mb-5">
                  <li className="flex gap-2"><Check className="w-4 h-4 text-on-tertiary-container shrink-0" /> {p.unlimited ? 'Unlimited interviews' : `${p.credits} credit-minutes / cycle`}</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-on-tertiary-container shrink-0" /> Up to {p.perInterviewCapMinutes} min per interview</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-on-tertiary-container shrink-0" /> Full report + transcript + dashboard</li>
                </ul>
                <button
                  onClick={() => buy(p)}
                  disabled={!!busy || current}
                  className={cn('w-full py-3 rounded-xl font-headline font-bold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2',
                    featured ? 'bg-on-tertiary-container text-white hover:brightness-110' : 'bg-primary text-on-primary hover:bg-primary-container')}
                >
                  {busy === p.code ? <Loader2 className="w-4 h-4 animate-spin" /> : current ? 'Current plan' : `Choose ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-secondary mt-4">Secure payments by Razorpay · GST invoice issued on payment · cancel anytime.</p>
      </section>

      {/* Ledger */}
      {ledger.length > 0 && (
        <section className="no-line-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/15"><h2 className="font-headline font-bold text-base text-primary">Credit history</h2></div>
          <div className="divide-y divide-outline-variant/10 max-h-80 overflow-y-auto scrolling-log">
            {ledger.map((l) => (
              <div key={l._id} className="px-6 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium text-primary capitalize">{l.type.replace(/_/g, ' ')}</span>
                  {l.reason && <span className="text-secondary"> · {l.reason}</span>}
                  <div className="text-[11px] text-secondary/70">{new Date(l.createdAt).toLocaleString()}</div>
                </div>
                <span className={cn('font-mono font-semibold', l.amount > 0 ? 'text-green-700' : l.amount < 0 ? 'text-error' : 'text-secondary')}>
                  {l.amount > 0 ? '+' : ''}{l.amount}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
