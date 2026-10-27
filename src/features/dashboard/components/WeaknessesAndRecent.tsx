import { ChevronRight } from 'lucide-react';
import { deltaClass, fmtDate, fmtDelta, shortLabel } from '../format';
import type { DashboardOverview, RecentInterview, WeaknessItem } from '../types';
import { cn } from '@/src/lib/utils';

const TREND_CLASS: Record<WeaknessItem['trend']['direction'], string> = {
  improving: 'text-green-700', worse: 'text-red-700', flat: 'text-secondary',
};

export function Weaknesses({ items, onLesson }: { items: WeaknessItem[]; onLesson: (href: string) => void }) {
  return (
    <section className="no-line-card p-5 flex-[1_1_340px] flex flex-col gap-1.5">
      <h2 className="font-headline font-bold text-base text-primary">Recurring weaknesses</h2>
      <p className="text-[12.5px] text-secondary mb-1.5">Flagged across your interviews, most frequent first.</p>
      {items.length === 0 && <p className="text-sm text-secondary py-3">Patterns show up after a few scored interviews.</p>}
      {items.map((w) => (
        <div key={w.id} className="py-3 border-t border-outline-variant/15 flex flex-col gap-1.5">
          <div className="flex justify-between gap-2.5">
            <span className="text-sm font-semibold text-primary">{w.label}</span>
            <span className="text-[13px] font-bold text-primary">{w.percent}%</span>
          </div>
          <div className="h-[5px] rounded-full bg-surface-container"><div className="h-[5px] rounded-full bg-primary" style={{ width: `${w.percent}%` }} /></div>
          <div className="flex flex-wrap justify-between gap-x-2.5 text-xs">
            <span className="text-secondary">{w.occurrences.count} of {w.occurrences.total} · {w.types.join(', ')}</span>
            <span className={cn('font-semibold', TREND_CLASS[w.trend.direction])}>{w.trend.text}</span>
          </div>
          <button type="button" onClick={() => onLesson(w.lesson.href)} className="self-start text-[12.5px] font-semibold text-on-tertiary-container hover:underline">
            Lesson: {w.lesson.title} →
          </button>
        </div>
      ))}
    </section>
  );
}

export function RecentInterviews({ overview, onOpen }: { overview: DashboardOverview; onOpen: (r: RecentInterview) => void }) {
  const { items, total, hiddenShort } = overview.recent;
  const label = (r: RecentInterview) => {
    const t = overview.types.find((x) => x.key === r.typeKey);
    return t ? shortLabel(t) : r.typeKey;
  };

  return (
    <section className="no-line-card p-5 pb-3 flex-[2_1_560px] min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline font-bold text-base text-primary">Recent interviews</h2>
        {total > 0 && <span className="text-[13px] text-secondary">{total} total</span>}
      </div>
      <p className="text-[12.5px] text-secondary mt-1">
        {items.length > 0 ? 'Click a row to see what went wrong.' : 'Your interviews will appear here after your first one.'}
        {hiddenShort > 0 && ` ${hiddenShort} unfinished session${hiddenShort === 1 ? '' : 's'} under a minute ${hiddenShort === 1 ? 'is' : 'are'} hidden.`}
      </p>
      <ul className="mt-2.5">
        {items.map((r) => (
          <li key={r.id} className="border-t border-outline-variant/15">
            <button
              type="button"
              onClick={() => onOpen(r)}
              className="w-full grid grid-cols-[48px_84px_minmax(0,1fr)_72px_16px] sm:grid-cols-[56px_96px_minmax(0,1fr)_72px_44px_16px] gap-3 items-center py-3 px-2 -mx-2 w-[calc(100%+1rem)] rounded-lg text-left hover:bg-on-tertiary-container/[0.06] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-on-tertiary-container/50"
            >
              <span className="text-[12.5px] text-secondary">{fmtDate(r.date)}</span>
              <span className="text-[12.5px] font-semibold text-on-tertiary-container truncate">{label(r)}</span>
              <span className="text-[13.5px] font-semibold text-primary truncate">{r.title}</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold text-primary">{r.score.toFixed(1)}</span>
                <span className={cn('text-[11.5px] font-semibold', deltaClass(r.deltaVsPrevious))}>{fmtDelta(r.deltaVsPrevious)}</span>
              </span>
              <span className="hidden sm:block text-[12.5px] text-secondary">{r.durationMinutes}m</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
