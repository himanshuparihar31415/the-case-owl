import { Link } from 'react-router-dom';
import { Repeat, ArrowRight, Clock } from 'lucide-react';
import type { DashLite, InterviewModule } from '@/src/lib/practice';

const MIN_SESSIONS = 3; // below this a "70%" is just 2 of 3 — not a pattern

export default function RecurringMistakes({ habits, sessions, module }: { habits: DashLite['habits']; sessions: number; module: InterviewModule }) {
  const top = habits.filter((h) => h.total > 0).slice(0, 3);

  return (
    <section className="no-line-card p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <Repeat className="w-4 h-4 text-on-tertiary-container" />
        <h2 className="font-headline font-bold text-base text-primary">Your Top Recurring Mistakes</h2>
      </div>

      {sessions < MIN_SESSIONS ? (
        <div className="flex-1 rounded-xl border border-dashed border-outline-variant/40 p-5 text-center">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-on-tertiary-fixed-variant bg-tertiary-fixed px-2 py-0.5 rounded"><Clock className="w-3 h-3" /> Unlocks at {MIN_SESSIONS} interviews</span>
          <p className="font-headline font-bold text-sm text-primary mt-2">One slip is noise. Three is a habit.</p>
          <p className="text-[12.5px] text-secondary mt-1 leading-snug">
            {sessions === 0 ? 'Run your first interview and we start tracking.' : `${MIN_SESSIONS - sessions} more scored interview${MIN_SESSIONS - sessions === 1 ? '' : 's'} and we can name your repeat offenders.`}
          </p>
        </div>
      ) : top.length === 0 ? (
        <div className="flex-1 rounded-xl bg-surface-container-low p-5 text-center">
          <p className="font-headline font-bold text-sm text-primary">Nothing keeps repeating.</p>
          <p className="text-[12.5px] text-secondary mt-1">No habit has been flagged across your sessions. Keep it that way.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {top.map((h, i) => {
            const pct = Math.round((h.count / h.total) * 100);
            const col = pct >= 70 ? '#ba1a1a' : '#CF7C20';
            return (
              <li key={h.tag}>
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-md bg-surface-container-low text-secondary font-headline font-bold text-xs flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-headline font-bold text-[13.5px] text-primary truncate">{h.label}</span>
                      <span className="font-mono text-[11px] font-semibold shrink-0" style={{ color: col }}>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
                    </div>
                    <p className="text-[11.5px] text-secondary mt-1">Flagged in {h.count} of your {h.total} interviews.</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Link to="/config" state={{ module }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-headline font-bold text-[12px] hover:scale-[0.97] transition">
                      Drill this <ArrowRight className="w-3 h-3" />
                    </Link>
                    <Link to={`/lesson/${h.tag}?m=${module}`} className="text-[11px] font-semibold text-on-tertiary-container hover:underline">Read the lesson</Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
