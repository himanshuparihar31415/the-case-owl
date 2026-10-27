import { useState } from 'react';
import { Minus, Plus, Loader2 } from 'lucide-react';
import { WEEKS_PER_MONTH } from '../config';
import { formatShortDate, suggestTargets } from '../logic';
import type { DashboardOverview, Period, Targets } from '../types';
import Overlay from './Overlay';
import { cn } from '@/src/lib/utils';

interface Props {
  overview: DashboardOverview;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (targets: Targets) => void;
}

function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string }) {
  const btn = 'w-9 h-9 rounded-lg border border-outline-variant/50 flex items-center justify-center text-primary hover:border-primary/40 disabled:opacity-40 transition';
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}><Minus className="w-4 h-4" /></button>
      <div className="w-11 text-center font-headline font-extrabold text-xl text-primary" aria-live="polite">{value}</div>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}><Plus className="w-4 h-4" /></button>
    </div>
  );
}

export default function TargetsModal({ overview, saving, error, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Targets>(overview.targets);

  const { profile } = overview;
  const suggestion = profile.timeline ? suggestTargets(profile.timeline) : null;
  const companies = profile.companies.length
    ? `, targeting ${profile.companies.slice(0, 3).join(', ')}${profile.companies.length > 3 ? ` and ${profile.companies.length - 3} more` : ''}`
    : '';

  const setPeriod = (period: Period) => {
    if (period === draft.period) return;
    // Keep the same pace when switching units.
    const interviews = period === 'month'
      ? Math.round(draft.interviews * WEEKS_PER_MONTH)
      : Math.max(1, Math.round(draft.interviews / WEEKS_PER_MONTH));
    setDraft({ ...draft, period, interviews });
  };

  const seg = (on: boolean) => cn('px-3 py-1 rounded-md text-xs font-semibold transition', on ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-secondary hover:text-primary');

  return (
    <Overlay onClose={onClose} labelledBy="targets-title">
      <h2 id="targets-title" className="font-headline font-extrabold text-xl text-primary">Weekly targets</h2>
      {suggestion && (
        <p className="mt-1.5 text-[13px] text-secondary leading-relaxed">
          Suggested from onboarding{profile.placementDate ? `: placements ${formatShortDate(profile.placementDate)}` : ''}{companies}.
          {' '}That points to {suggestion.prep} lessons and {suggestion.interviews} interviews a week.
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-primary">Prep</div>
          <div className="text-[12.5px] text-secondary">Lessons per week</div>
        </div>
        <Stepper label="lessons per week" value={draft.prep} min={1} max={14} onChange={(prep) => setDraft({ ...draft, prep })} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-primary">Interviews</div>
          <div className="mt-1.5 inline-flex bg-surface-container-low rounded-lg p-0.5" role="group" aria-label="Interview target period">
            <button type="button" aria-pressed={draft.period === 'week'} onClick={() => setPeriod('week')} className={seg(draft.period === 'week')}>Per week</button>
            <button type="button" aria-pressed={draft.period === 'month'} onClick={() => setPeriod('month')} className={seg(draft.period === 'month')}>Per month</button>
          </div>
        </div>
        <Stepper label="interviews" value={draft.interviews} min={1} max={40} onChange={(interviews) => setDraft({ ...draft, interviews })} />
      </div>

      {error && <p role="alert" className="mt-3 text-[13px] text-error">{error}</p>}

      <div className="mt-5 flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg text-sm font-semibold text-secondary border border-outline-variant/50 hover:text-primary transition">Cancel</button>
        <button type="button" disabled={saving} onClick={() => onSave(draft)} className="px-4 py-2.5 rounded-lg text-sm font-bold bg-primary text-on-primary hover:bg-primary-container transition disabled:opacity-60 inline-flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save targets
        </button>
      </div>
    </Overlay>
  );
}
