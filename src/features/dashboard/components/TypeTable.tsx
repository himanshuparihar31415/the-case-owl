import { Play } from 'lucide-react';
import { lessonsDone, lessonsTotal, typeStatus, upNext } from '../logic';
import type { DashboardOverview, LessonRef, TypeKey } from '../types';
import { cn } from '@/src/lib/utils';

const GRID = 'grid grid-cols-[minmax(110px,1.2fr)_minmax(100px,1.3fr)_minmax(90px,1fr)_56px_92px_64px] gap-3 items-center';

export function TypeTable({ overview, onStart }: { overview: DashboardOverview; onStart: (k: TypeKey) => void }) {
  const { types, readiness } = overview;
  return (
    <section className="no-line-card p-5 pb-2 flex-[2_1_600px] min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline font-bold text-base text-primary">Readiness by interview type</h2>
        <div className="text-[12.5px] text-secondary">Blue tick = the {readiness.bar}/10 bar firms expect</div>
      </div>
      <div className="overflow-x-auto scrolling-log">
        <div className="min-w-[640px]">
          <div className={cn(GRID, 'mt-3.5 pb-2 border-b border-outline-variant/25 label-blueprint font-semibold')} role="row">
            <div>TYPE</div><div>SCORE</div><div>PREP</div><div>DONE</div><div>STATUS</div><div />
          </div>
          {types.map((t) => {
            const st = typeStatus(t, readiness.bar);
            const prepShare = t.lessonsTotal ? (t.lessonsDone / t.lessonsTotal) * 100 : 0;
            return (
              <div key={t.key} className={cn(GRID, 'py-3 border-b last:border-b-0 border-outline-variant/15')} role="row">
                <div className="text-sm font-semibold text-primary">{t.label}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold w-[30px] text-primary">{t.score == null ? '—' : t.score.toFixed(1)}</span>
                  <div className="flex-1 relative h-1.5 rounded-full bg-surface-container">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(t.score ?? 0) * 10}%` }} />
                    <div className="absolute -top-[3px] w-0.5 h-3 bg-on-tertiary-container" style={{ left: `${readiness.bar * 10}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-slate-700 w-[34px]">{t.lessonsDone}/{t.lessonsTotal}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-container"><div className="h-1.5 rounded-full bg-on-tertiary-container" style={{ width: `${prepShare}%` }} /></div>
                </div>
                <div className="text-[13px] text-slate-700">{t.interviewsDone}</div>
                <div><span className={cn('text-[11.5px] font-bold px-2 py-0.5 rounded-md', st.badge)}>{st.label}</span></div>
                <button
                  type="button"
                  onClick={() => onStart(t.key)}
                  aria-label={`Start ${t.label} interview`}
                  className="justify-self-end px-2.5 py-1.5 rounded-lg border border-outline-variant/50 text-[12.5px] font-semibold text-primary hover:border-primary transition"
                >
                  Start
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function LearnCard({ overview, focus, onLesson }: { overview: DashboardOverview; focus: TypeKey; onLesson: (l: LessonRef) => void }) {
  const done = lessonsDone(overview);
  const total = lessonsTotal(overview);
  const next = upNext(overview, focus);
  const mins = (l: LessonRef) => `${overview.types.find((t) => t.key === l.typeKey)?.label ?? ''} · ${l.minutes} min`;

  return (
    <section className="no-line-card p-5 flex-[1_1_300px] flex flex-col gap-3.5">
      <h2 className="font-headline font-bold text-base text-primary">Learn</h2>
      <div className="flex items-baseline gap-1.5">
        <span className="font-headline font-extrabold text-[32px] leading-none tracking-tight text-primary">{done}</span>
        <span className="text-[15px] text-secondary">of {total} lessons</span>
      </div>
      <div className="h-2 rounded-full bg-surface-container" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Lessons completed">
        <div className="h-2 rounded-full bg-on-tertiary-container" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <div className="text-[12.5px] text-secondary">{total - done} pending · {overview.activity.weekPrep} this week</div>

      <div className="label-blueprint font-bold mt-1.5">UP NEXT</div>
      {next.length === 0 && <p className="text-sm text-secondary">You’ve finished every lesson. Keep practising in interviews.</p>}
      <ul className="flex flex-col">
        {next.map((l) => (
          <li key={l.id} className="border-t border-outline-variant/15">
            <button type="button" onClick={() => onLesson(l)} className="w-full flex items-center gap-3 py-2.5 text-left group">
              <span className="w-8 h-8 rounded-lg bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center shrink-0"><Play className="w-3.5 h-3.5 fill-current" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-primary group-hover:underline truncate">{l.title}</span>
                <span className="block text-xs text-secondary">{mins(l)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
