import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bug, History, Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { DIFFICULTY_LABEL, type HistoryRow, type InterviewType } from '@/src/lib/practice';

const GRADE_LABEL: Record<string, { t: string; c: string }> = {
  STRONG_PASS: { t: 'Strong Hire', c: 'bg-green-100 text-green-700' },
  PASS: { t: 'Hire', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  BORDERLINE: { t: 'Borderline', c: 'bg-amber-100 text-amber-700' },
  FAIL: { t: 'No Hire', c: 'bg-error-container/60 text-error' },
};
const RANGES = [
  { id: 'all', label: 'All time', days: 0 },
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
] as const;
const PAGE = 10;

const pretty = (t?: string) => (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : '');
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDur = (s: number | null) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`);

export default function InterviewHistory({ rows, loaded }: { rows: HistoryRow[]; loaded: boolean }) {
  const [type, setType] = useState<InterviewType | 'All'>('All');
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('all');
  const [shown, setShown] = useState(PAGE);

  const types = useMemo(() => [...new Set(rows.map((r) => r.type))], [rows]);
  const hasCompany = rows.some((r) => r.company);

  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const cutoff = days ? Date.now() - days * 86_400_000 : 0;
    return rows.filter((r) => (type === 'All' || r.type === type) && r.ts >= cutoff);
  }, [rows, type, range]);

  const cols = hasCompany
    ? 'md:grid-cols-[96px_96px_minmax(0,1fr)_110px_100px_150px_56px_92px]'
    : 'md:grid-cols-[96px_96px_minmax(0,1fr)_100px_150px_56px_92px]';

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-on-tertiary-container" />
          <h2 className="font-headline font-bold text-base text-primary">Interview History</h2>
          <span className="text-[12px] text-secondary">{filtered.length === rows.length ? `${rows.length} total` : `${filtered.length} of ${rows.length}`}</span>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {types.length > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto scrolling-log">
                {(['All', ...types] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setType(t); setShown(PAGE); }}
                    className={cn('px-3 py-1 rounded-lg text-[12px] font-bold whitespace-nowrap transition', type === t ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-secondary hover:text-primary')}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <select
              value={range}
              onChange={(e) => { setRange(e.target.value as typeof range); setShown(PAGE); }}
              aria-label="Date range"
              className="bg-surface-container-low border-none rounded-lg text-[12px] font-bold text-secondary py-1.5 pl-3 pr-8 focus:ring-0 cursor-pointer"
            >
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {!loaded ? (
        <div className="no-line-card p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-on-tertiary-container" /></div>
      ) : rows.length === 0 ? (
        <div className="no-line-card p-8 text-center">
          <p className="font-headline font-bold text-primary">Nothing to debug yet.</p>
          <p className="text-[13px] text-secondary mt-1 max-w-md mx-auto">Every finished interview lands here with a report you can pull apart, line by line. Do one.</p>
          <Link to="/config" state={{ module: 'case' }} className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-primary text-on-primary font-headline font-bold rounded-lg text-sm hover:scale-[0.98] transition">Start an interview</Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="no-line-card p-8 text-center">
          <p className="font-headline font-bold text-primary">Nothing matches those filters.</p>
          <button type="button" onClick={() => { setType('All'); setRange('all'); }} className="mt-2 text-[13px] font-semibold text-on-tertiary-container hover:underline">Clear filters</button>
        </div>
      ) : (
        <div className="no-line-card overflow-hidden">
          <div className={cn('hidden md:grid gap-3 px-4 py-2 bg-surface-container-low label-blueprint', cols)}>
            <span>Date</span><span>Type</span><span>Interview</span>
            {hasCompany && <span>Company</span>}
            <span>Difficulty</span><span>Score</span><span>Time</span><span />
          </div>
          <div className="divide-y divide-outline-variant/10">
            {filtered.slice(0, shown).map((r) => {
              const g = r.grade ? GRADE_LABEL[r.grade] : null;
              return (
                <div key={String(r.sessionId)} className={cn('grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center px-4 py-3 hover:bg-surface-container-low transition', cols)}>
                  <span className="hidden md:block text-[12.5px] text-secondary">{fmtDate(r.ts)}</span>
                  <span className="hidden md:block"><span className="text-[11px] font-bold text-on-tertiary-container">{r.type}</span></span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[13px] text-primary truncate">{r.caseTitle}</p>
                    <p className="text-[11px] text-secondary truncate md:hidden">
                      {fmtDate(r.ts)} · {r.type}{r.difficulty ? ` · ${DIFFICULTY_LABEL[r.difficulty] ?? ''}` : ''} · {fmtDur(r.durationSeconds)}
                    </p>
                    {r.industry && <p className="text-[11px] text-secondary truncate hidden md:block">{pretty(r.industry)}</p>}
                  </div>
                  {hasCompany && <span className="hidden md:block text-[12.5px] text-primary truncate">{r.company ?? '—'}</span>}
                  <span className="hidden md:block text-[12.5px] text-secondary">{r.difficulty ? (DIFFICULTY_LABEL[r.difficulty] ?? '—') : '—'}</span>
                  <div className="hidden md:flex items-center gap-2">
                    {r.score != null
                      ? <span className="font-headline font-bold text-[14px] text-primary">{(r.score / 10).toFixed(1)}<span className="text-[10px] text-secondary">/10</span></span>
                      : <span className="text-[11px] text-secondary italic">no score</span>}
                    {g && <span className={cn('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded', g.c)}>{g.t}</span>}
                  </div>
                  <span className="hidden md:block text-[12.5px] text-secondary">{fmtDur(r.durationSeconds)}</span>
                  <div className="flex items-center gap-2 justify-end">
                    {/* mobile-only score; desktop has its own column */}
                    {r.score != null && <span className="md:hidden font-headline font-bold text-[13px] text-primary">{(r.score / 10).toFixed(1)}</span>}
                    <Link
                      to={`/report/${r.sessionId}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/25 text-primary font-headline font-bold text-[12px] hover:bg-primary hover:text-on-primary transition"
                    >
                      <Bug className="w-3.5 h-3.5" /> Debug
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          {shown < filtered.length && (
            <button type="button" onClick={() => setShown((s) => s + PAGE)} className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold text-on-tertiary-container border-t border-outline-variant/10 hover:bg-surface-container-low transition">
              <ChevronDown className="w-4 h-4" /> Show more ({filtered.length - shown} more)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
