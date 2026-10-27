import type { Tracker } from '../logic';
import { cn } from '@/src/lib/utils';

export function TrackerCard({ t }: { t: Tracker }) {
  return (
    <div className="no-line-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="label-blueprint font-bold">{t.eyebrow}</div>
        {t.fresh && <span className="text-xs font-bold px-2 py-0.5 rounded-md text-slate-600 bg-slate-100">Just started</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-headline font-extrabold text-[32px] leading-none tracking-tight text-primary">{t.done}</span>
        <span className="text-[15px] text-secondary">of {t.target} {t.unit}</span>
      </div>
      <div
        className="relative h-2 rounded-full bg-surface-container"
        role="progressbar" aria-valuemin={0} aria-valuemax={t.target} aria-valuenow={t.done}
        aria-label={`${t.eyebrow.toLowerCase()}: ${t.done} of ${t.target} ${t.unit}`}
      >
        <div className="h-2 rounded-full bg-on-tertiary-container transition-[width] duration-500" style={{ width: `${t.fill}%` }} />
        {!t.fresh && <div className="absolute -top-[5px] w-0.5 h-[18px] bg-primary" style={{ left: `${t.marker}%` }} title="Expected by today" />}
      </div>
      <div className="flex justify-between gap-2 text-[12.5px] text-secondary">
        <span>{t.expectedText}</span>
        <span className="font-semibold text-primary shrink-0">{t.note}</span>
      </div>
    </div>
  );
}
