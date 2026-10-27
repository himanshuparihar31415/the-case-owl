import { ArrowRight } from 'lucide-react';
import { readinessLabel, type Nudge, type NudgeAction } from '../logic';
import type { DashboardOverview } from '../types';

interface Props {
  overview: DashboardOverview;
  nudge: Nudge;
  onAction: (a: NudgeAction) => void;
}

/** The single next action, plus where the user stands against the bar firms expect. */
export default function CoachCard({ overview, nudge, onAction }: Props) {
  const { overall, bar, label, deltaNote } = overview.readiness;
  const hasScore = overall != null;

  return (
    <section aria-label="Your next step" className="rounded-2xl bg-primary text-white overflow-hidden flex flex-wrap">
      <div className="flex-[1_1_480px] p-6 flex flex-col gap-2.5">
        <div className="flex items-center gap-2 label-blueprint !text-on-tertiary-container font-bold">
          <span className={`w-[7px] h-[7px] rounded-full ${nudge.dot}`} aria-hidden="true" />
          {nudge.eyebrow}
        </div>
        <h2 className="font-headline font-bold text-[22px] leading-snug tracking-tight text-balance">{nudge.title}</h2>
        <p className="text-[14.5px] leading-relaxed text-white/75 max-w-[600px] text-pretty">{nudge.body}</p>
        <div className="flex flex-wrap gap-2.5 mt-2">
          <button
            type="button"
            onClick={() => onAction(nudge.primary)}
            className="inline-flex items-center gap-2 px-[18px] py-2.5 rounded-lg bg-on-tertiary-container text-white text-sm font-bold hover:brightness-95 active:scale-[0.98] transition"
          >
            {nudge.primary.label} <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.6} />
          </button>
          {nudge.secondary && (
            <button
              type="button"
              onClick={() => onAction(nudge.secondary!)}
              className="px-[18px] py-2.5 rounded-lg border border-white/25 text-white text-sm font-semibold hover:bg-white/10 transition"
            >
              {nudge.secondary.label}
            </button>
          )}
        </div>
      </div>

      <div className="flex-[0_1_280px] bg-primary-container p-6 flex flex-col justify-center gap-2">
        <div className="label-blueprint !text-white/60 font-bold">OVERALL READINESS</div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-headline font-extrabold text-[40px] leading-none tracking-tight">{hasScore ? overall!.toFixed(1) : '—'}</span>
          {hasScore && <span className="text-[15px] text-white/60">/10</span>}
          <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-md bg-white/15">{readinessLabel(overall, label)}</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-white/15" role="img" aria-label={hasScore ? `Readiness ${overall!.toFixed(1)} out of 10, bar is ${bar}` : 'No readiness score yet'}>
          <div className="h-1.5 rounded-full bg-on-tertiary-container" style={{ width: `${hasScore ? Math.min(100, overall! * 10) : 0}%` }} />
          <div className="absolute -top-1 w-0.5 h-3.5 bg-white" style={{ left: `${bar * 10}%` }} />
        </div>
        <div className="text-[12.5px] text-white/75">
          {hasScore ? <>Firms expect {bar}. {deltaNote}</> : <>Firms expect {bar}. Your first scored interview sets your starting point.</>}
        </div>
      </div>
    </section>
  );
}
