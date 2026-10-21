import { Link } from 'react-router-dom';
import { ClipboardList, ArrowRight, Check } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { WEEKLY_GOAL, type PlanItem } from '@/src/lib/practice';

const KIND_CLS: Record<PlanItem['kind'], string> = {
  FIX: 'bg-error-container/60 text-error',
  GROW: 'bg-amber-100 text-amber-700',
  EXPLORE: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
};

export default function PrepPlan({ items, weekCount }: { items: PlanItem[]; weekCount: number }) {
  const pct = Math.min(100, Math.round((weekCount / WEEKLY_GOAL) * 100));
  const hit = weekCount >= WEEKLY_GOAL;

  return (
    <section className="no-line-card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList className="w-4 h-4 text-on-tertiary-container" />
        <h2 className="font-headline font-bold text-base text-primary">Your Prep Plan</h2>
      </div>

      {/* Weekly goal */}
      <div className="rounded-xl bg-surface-container-low px-3.5 py-3 mb-3">
        <div className="flex items-center justify-between text-[12px] mb-1.5">
          <span className="font-semibold text-primary">Weekly goal</span>
          <span className={cn('font-mono font-semibold', hit ? 'text-green-700' : 'text-secondary')}>
            {hit && <Check className="inline w-3.5 h-3.5 mr-0.5 -mt-0.5" />}{weekCount} / {WEEKLY_GOAL} reps
          </span>
        </div>
        <div className="h-2 bg-surface-container-highest rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: hit ? '#1C9A6A' : '#08aae4' }} />
        </div>
        <p className="text-[11px] text-secondary mt-1.5">{hit ? 'Goal hit. Anything more is margin.' : `${WEEKLY_GOAL - weekCount} more to hit this week's goal.`}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex-1 rounded-xl border border-dashed border-outline-variant/40 p-5 text-center">
          <p className="font-headline font-bold text-sm text-primary">No plan yet.</p>
          <p className="text-[12.5px] text-secondary mt-1 leading-snug">We plan from your results, and you don&apos;t have any. Finish an interview and this fills in.</p>
          <Link to="/config" state={{ module: 'case' }} className="inline-flex items-center gap-1.5 mt-3 text-[13px] font-semibold text-on-tertiary-container hover:underline">
            Start your first interview <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-outline-variant/10">
          {items.map((it) => (
            <li key={it.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
              <span className={cn('font-mono text-[10px] font-bold px-1.5 py-1 rounded shrink-0 mt-0.5', KIND_CLS[it.kind])}>{it.kind}</span>
              <div className="flex-1 min-w-0">
                <div className="font-headline font-bold text-[13.5px] text-primary leading-snug">{it.focus}</div>
                <p className="text-[12px] text-secondary leading-snug mt-0.5">{it.reason}</p>
              </div>
              <Link
                to="/config"
                state={{ module: it.module, archetype: it.archetype }}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-headline font-bold text-[12px] hover:scale-[0.97] transition"
              >
                Start drill <ArrowRight className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
