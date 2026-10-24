import { useEffect, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/lib/api';
import StreakHero from '@/src/components/dashboard/StreakHero';
import PrepPlan from '@/src/components/dashboard/PrepPlan';
import RecurringMistakes from '@/src/components/dashboard/RecurringMistakes';
import FirmReadiness from '@/src/components/dashboard/FirmReadiness';
import InterviewHistory from '@/src/components/dashboard/InterviewHistory';
import CollegeArena from '@/src/components/dashboard/CollegeArena';
import {
  buildHistoryRows, buildPrepPlan, countByDay, moduleOf, thisWeekCount, type HistoryItem,
} from '@/src/lib/practice';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface AuthUser { name: string; email: string }

interface Dashboard {
  totals: { sessions: number; weeks: number };
  readiness: { overall: number; delta3: number; band: string; target: number };
  trajectory: any[];
  movers: any[];
  progressBottleneck: { key: string; label: string; score: number; sessions: number } | null;
  deltaCallout: string;
  caseTypes: any[];
  variance: { series: number[]; mean: number; stdev: number };
  timeSignature: any[];
  habits: any[];
  evidence: any[];
  insight: any | null;
}

export default function Dashboard({ user }: { user: AuthUser | null }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [mod, setMod] = useState<'all' | 'case' | 'product' | 'guesstimate'>('all');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histLoaded, setHistLoaded] = useState(false);

  // Every completed interview, newest first — the streak heatmap and the history table both need the full set.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all: HistoryItem[] = [];
      for (let page = 1; page <= 50; page++) {
        const d = await api.get<{ history: HistoryItem[]; total: number }>(`/analytics/history?page=${page}&limit=100`);
        all.push(...d.history);
        if (!cancelled) setHistory([...all]);
        if (all.length >= d.total || d.history.length === 0) break;
      }
    })().catch(() => { /* keep what loaded */ }).finally(() => { if (!cancelled) setHistLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Don't toggle the full-page loader on tab switches — keep the prior view
    // until the scoped data arrives (avoids the tab row flickering away).
    api.get<Dashboard>(`/analytics/dashboard${mod === 'all' ? '' : `?module=${mod}`}`)
      .then(setData).catch(() => { /* keep prior */ }).finally(() => setLoading(false));
  }, [mod]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  if (loading) {
    return <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>;
  }

  // Empty state — only when there's NOTHING at all (the unscoped view is empty).
  // A scoped view with 0 sessions still renders so the track tabs stay visible.
  if (!data) {
    return (
      <div className="py-20 text-center space-y-6 max-w-xl mx-auto">
        <h1 className="power-gap-h1 text-primary">Welcome, {firstName}.</h1>
        <p className="text-secondary text-lg">Your progress dashboard unlocks after your first case. It learns your recurring patterns across sessions and tells you exactly what to fix next.</p>
        <Link to="/config" className="inline-flex items-center gap-3 px-10 py-4 bg-primary text-on-primary font-headline font-bold rounded-lg hover:scale-[0.98] transition">
          Start your first case <Play className="w-5 h-5 fill-current" />
        </Link>
      </div>
    );
  }

  // ── practice cockpit (all derived client-side from data we already fetched) ──
  const hasReports = data.totals.sessions > 0;
  const lastModule = history[0] ? moduleOf(history[0].caseType) : 'case';
  const weekCount = thisWeekCount(countByDay(history));
  const planItems = buildPrepPlan(data, lastModule);
  const historyRows = buildHistoryRows(history, data.trajectory);

  return (
    <div className="space-y-5 py-1">
      {/* ── HEADER: greeting + readiness chip ── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 label-blueprint mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 ring-4 ring-green-500/20" />
            {data.totals.sessions} sessions · {data.totals.weeks} weeks
          </div>
          <h1 className="font-headline font-bold text-xl text-primary leading-tight truncate">Welcome back, {firstName}.</h1>
        </div>
        {hasReports && <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-surface-container-low shrink-0">
          <span className="font-headline font-extrabold text-lg text-primary leading-none">{data.readiness.overall.toFixed(1)}<span className="text-[11px] text-secondary font-medium">/10</span></span>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] font-semibold text-primary">{data.readiness.band}</span>
            <span className={cn('text-[10px] font-semibold', data.readiness.delta3 >= 0 ? 'text-green-700' : 'text-error')}>
              {data.readiness.delta3 >= 0 ? '+' : ''}{data.readiness.delta3.toFixed(1)} last 3
            </span>
          </div>
        </div>}
      </div>

      {/* ═══════════════ PRACTICE COCKPIT ═══════════════ */}
      <StreakHero history={history} loaded={histLoaded} module={lastModule} />

      {histLoaded && <CollegeArena user={user} history={history} />}

      <div className="grid lg:grid-cols-2 gap-5 items-stretch">
        <PrepPlan items={planItems} weekCount={weekCount} />
        <RecurringMistakes habits={data.habits} sessions={data.totals.sessions} module={lastModule} />
      </div>

      <FirmReadiness overall={hasReports ? data.readiness.overall : null} bar={data.readiness.target} />

      <InterviewHistory rows={historyRows} loaded={histLoaded} />
    </div>
  );
}