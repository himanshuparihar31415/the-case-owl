import React, { useEffect, useMemo, useState } from 'react';
import {
  Play, Loader2, TrendingUp, TrendingDown, Minus, ArrowRight,
  Target, X, Briefcase, Boxes, Calculator, ChevronDown, GraduationCap,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/lib/api';

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

interface HistoryItem {
  sessionId: string; caseTitle: string; caseType?: string; industry?: string;
  status: string; score: number | null; grade: string | null; durationSeconds: number | null; date: string;
}

const GRADE_LABEL: Record<string, { t: string; c: string }> = {
  STRONG_PASS: { t: 'Strong Hire', c: 'bg-green-100 text-green-700' },
  PASS: { t: 'Hire', c: 'bg-tertiary-fixed text-on-tertiary-fixed-variant' },
  BORDERLINE: { t: 'Borderline', c: 'bg-amber-100 text-amber-700' },
  FAIL: { t: 'No Hire', c: 'bg-error-container/60 text-error' },
};
const prettyType = (t?: string) => (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Case');
const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };
const fmtDur = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}m`);

const trendIcon = (t: string) =>
  t === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : t === 'down' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />;
const trendCls = (t: string) =>
  t === 'up' ? 'text-green-700 bg-green-100' : t === 'down' ? 'text-error bg-error-container/60' : 'text-amber-700 bg-amber-100';

function Sparkline({ series, color }: { series: number[]; color: string }) {
  if (!series.length) return null;
  const w = 120, h = 30, max = Math.max(...series, 6), min = Math.min(...series, 0);
  const pts = series.map((v, i) => [
    (i / Math.max(1, series.length - 1)) * w,
    h - 2 - ((v - min) / Math.max(0.001, max - min)) * (h - 4),
  ]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.6} fill={color} />
    </svg>
  );
}

export default function Dashboard({ user }: { user: AuthUser | null }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<{ kind: string; arg?: string } | null>(null);
  const [mod, setMod] = useState<'all' | 'case' | 'product' | 'guesstimate'>('all');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histTotal, setHistTotal] = useState(0);
  const [histPage, setHistPage] = useState(1);
  const [histLoading, setHistLoading] = useState(false);

  const loadHistory = (page: number) => {
    setHistLoading(true);
    api.get<{ history: HistoryItem[]; total: number }>(`/analytics/history?page=${page}&limit=8`)
      .then((d) => { setHistory((prev) => (page === 1 ? d.history : [...prev, ...d.history])); setHistTotal(d.total); setHistPage(page); })
      .catch(() => { /* keep prior */ }).finally(() => setHistLoading(false));
  };
  useEffect(() => { loadHistory(1); }, []);

  useEffect(() => {
    // Don't toggle the full-page loader on tab switches — keep the prior view
    // until the scoped data arrives (avoids the tab row flickering away).
    api.get<Dashboard>(`/analytics/dashboard${mod === 'all' ? '' : `?module=${mod}`}`)
      .then(setData).catch(() => { /* keep prior */ }).finally(() => setLoading(false));
  }, [mod]);

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const ring = useMemo(() => {
    const pct = data ? Math.min(1, (data.readiness.overall ?? 0) / 10) : 0;
    const C = 2 * Math.PI * 48;
    return { C, offset: C * (1 - pct) };
  }, [data]);

  if (loading) {
    return <div className="flex items-center justify-center py-40"><Loader2 className="w-8 h-8 animate-spin text-on-tertiary-container" /></div>;
  }

  // Empty state — only when there's NOTHING at all (the unscoped view is empty).
  // A scoped view with 0 sessions still renders so the track tabs stay visible.
  if (!data || (mod === 'all' && data.totals.sessions === 0)) {
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

  const ins = data.insight;
  const evidenceFor = (tag?: string) => data.evidence.filter((e) => !tag || e.habitTag === tag);
  const showBottleneck = !!ins?.bottleneck || (!ins && data.totals.sessions < 3);
  const timingOffPace = data.timeSignature.filter((p) => /short|brief|limited|insufficient|long|shallow/i.test(p.verdict || '')).length;

  return (
    <div className="space-y-6 py-2">
      {/* ── TOP STRIP: greeting + track filter (scopes everything below) ── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 label-blueprint mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 ring-4 ring-green-500/20" />
            {data.totals.sessions} sessions · {data.totals.weeks} weeks
          </div>
          <h1 className="font-headline font-bold text-xl text-primary leading-tight truncate">Welcome back, {firstName}.</h1>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrolling-log -mx-1 px-1 shrink-0">
          {([['all', 'All'], ['case', 'Consulting'], ['product', 'Product'], ['guesstimate', 'Guesstimate']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMod(id)}
              className={cn('shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition',
                mod === id ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-secondary hover:text-primary')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {mod !== 'all' && data.totals.sessions === 0 && (
        <p className="text-xs text-secondary italic -mt-3">No sessions in this track yet.</p>
      )}

      {/* ── ZONE 1 · COCKPIT: readiness + #1 bottleneck side by side ── */}
      <section className={cn('grid gap-5', showBottleneck && 'lg:grid-cols-[1fr_1.4fr]')}>
        {/* Readiness card */}
        <div className="rounded-2xl p-5 text-white relative overflow-hidden flex flex-col justify-between" style={{ background: 'linear-gradient(160deg,#002046,#0A1B33)' }}>
          <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(8,170,228,.3),transparent 70%)' }} />
          <div className="relative">
            <div className="label-blueprint text-white/50">Cumulative readiness</div>
            <div className="flex items-center gap-4 my-3">
              <div className="relative w-24 h-24 shrink-0">
                <svg width="96" height="96" viewBox="0 0 112 112" className="-rotate-90">
                  <circle cx="56" cy="56" r="48" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="9" />
                  <circle cx="56" cy="56" r="48" fill="none" stroke="#2BB3E8" strokeWidth="9" strokeLinecap="round"
                    strokeDasharray={ring.C} strokeDashoffset={ring.offset} style={{ transition: 'stroke-dashoffset 1.2s ease' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-headline font-extrabold text-2xl leading-none">{data.readiness.overall.toFixed(1)}</span>
                  <span className="text-[10px] text-white/50 mt-0.5">/ 10</span>
                </div>
              </div>
              <div className="min-w-0">
                <span className={cn('inline-flex items-center gap-1.5 text-sm font-bold px-2.5 py-1 rounded-md',
                  data.readiness.delta3 >= 0 ? 'text-green-300 bg-green-500/15' : 'text-red-300 bg-red-500/15')}>
                  {data.readiness.delta3 >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {data.readiness.delta3 >= 0 ? '+' : ''}{data.readiness.delta3.toFixed(1)} <span className="font-normal opacity-70">last 3</span>
                </span>
                <p className="text-[12px] text-white/70 mt-2 leading-snug">
                  {ins?.readinessNote ?? <>You're in the <b className="text-white">{data.readiness.band}</b> band. Target firms expect ~{data.readiness.target}/10.</>}
                </p>
              </div>
            </div>
          </div>
          <div className="relative flex gap-2 mt-3 items-center">
            <Link to="/config" className="flex-1 flex items-center justify-center gap-2 bg-on-tertiary-container text-white rounded-xl py-2.5 font-semibold text-sm hover:brightness-110 transition">
              Resume training <Play className="w-4 h-4 fill-current" />
            </Link>
            <Link to="/library" className="text-sm font-semibold text-white/70 hover:text-white transition px-2 shrink-0">Browse cases</Link>
          </div>
        </div>

        {/* #1 bottleneck — promoted beside readiness */}
        {ins?.bottleneck ? (
          <section onClick={() => setDrawer({ kind: 'evidence' })}
            className="no-line-card overflow-hidden grid grid-cols-[6px_1fr_auto] cursor-pointer hover:shadow-lg transition group">
            <div style={{ background: 'linear-gradient(#ba1a1a,#E0922F)' }} />
            <div className="p-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="label-blueprint text-error">◆ Your #1 recurring bottleneck</span>
                <span className="text-[11px] font-mono text-on-tertiary-container group-hover:underline shrink-0 ml-2">Evidence →</span>
              </div>
              <h3 className="font-headline font-bold text-base text-primary mb-1">{ins.bottleneck.title}</h3>
              <p className="text-[13px] text-secondary leading-relaxed line-clamp-2">{ins.bottleneck.explanation}</p>
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {(ins.bottleneck.chain ?? []).map((c: any, i: number) => (
                  <React.Fragment key={i}>
                    <button onClick={(e) => { e.stopPropagation(); setDrawer({ kind: 'habit', arg: c.tag }); }}
                      className="inline-flex items-center gap-1.5 bg-surface-container-low border border-outline-variant/15 rounded-lg px-2 py-1 text-[12px] font-medium hover:border-on-tertiary-container hover:bg-surface-container-lowest transition">
                      {c.label} <span className="font-mono text-[11px] text-error font-semibold">{c.count}×</span>
                    </button>
                    {i < ins.bottleneck.chain.length - 1 && <span className="text-faint text-secondary">→</span>}
                  </React.Fragment>
                ))}
              </div>
              {ins.bottleneck.chain?.[0]?.tag && (
                <Link to={`/lesson/${ins.bottleneck.chain[0].tag}`} onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 mt-3 text-[12.5px] font-semibold text-on-tertiary-container hover:underline">
                  <GraduationCap className="w-3.5 h-3.5" /> Read the 2-min lesson before your next case →
                </Link>
              )}
            </div>
            <div className="p-5 border-l border-outline-variant/10 flex flex-col justify-center min-w-[120px]">
              <div className="font-headline font-extrabold text-3xl text-error leading-none">{ins.bottleneck.pointLossPct ?? '—'}%</div>
              <div className="text-[11px] text-secondary mt-1.5 max-w-[120px]">of point losses trace to this one chain</div>
            </div>
          </section>
        ) : (!ins && data.totals.sessions < 3) ? (
          <section className="no-line-card p-5 flex items-center gap-3 text-sm text-secondary">
            <Target className="w-4 h-4 text-on-tertiary-container shrink-0" />
            Complete {3 - data.totals.sessions} more session{3 - data.totals.sessions !== 1 ? 's' : ''} to unlock your recurring-bottleneck analysis and weekly plan.
          </section>
        ) : null}
      </section>

      {/* ── START A SESSION: slim module row ── */}
      <section className="grid grid-cols-3 gap-3">
        {([
          { module: 'case', label: 'Consulting', Icon: Briefcase },
          { module: 'product', label: 'Product', Icon: Boxes },
          { module: 'guesstimate', label: 'Guesstimate', Icon: Calculator },
        ] as const).map(({ module, label, Icon }) => (
          <Link key={module} to="/config" state={{ module }}
            className="no-line-card px-4 py-3 flex items-center gap-2.5 hover:shadow-md hover:border-on-tertiary-container/40 transition group">
            <span className="w-8 h-8 rounded-lg bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container shrink-0">
              <Icon className="w-4 h-4" />
            </span>
            <span className="font-headline font-bold text-sm text-primary truncate">{label}</span>
            <ArrowRight className="w-4 h-4 text-secondary group-hover:text-on-tertiary-container group-hover:translate-x-0.5 transition ml-auto shrink-0" />
          </Link>
        ))}
      </section>

      {/* ── ZONE 2 · PROGRESS: trajectory + movers ── */}
      <div>
        <h2 className="font-headline font-bold text-base text-primary mb-3">How you're trending</h2>
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
          <div className="no-line-card p-4">
            <div className="flex items-center gap-3 mb-2 text-[11px] font-medium text-secondary">
              <span className="flex items-center gap-1.5"><i className="w-3 h-0.5 rounded" style={{ background: '#002046' }} /> Overall</span>
              <span className="flex items-center gap-1.5"><i className="w-3 h-0.5 rounded" style={{ background: '#08aae4' }} /> Structuring</span>
              <span className="flex items-center gap-1.5"><i className="w-3 h-0.5 rounded" style={{ background: '#ba1a1a' }} /> Quant</span>
              <span className="flex items-center gap-1.5"><i className="w-3 h-0.5 rounded" style={{ background: '#1FA971' }} /> Target</span>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={data.trajectory} onClick={(s: any) => { const p = s?.activePayload?.[0]?.payload; if (p?.sessionId) navigate(`/report/${p.sessionId}`); }} style={{ cursor: 'pointer' }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey="n" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11 }} width={24} />
                <Tooltip formatter={(v: any, name: string) => [Number(v).toFixed(1), name]} labelFormatter={(l: any, payload: any) => { const p = payload?.[0]?.payload; return p ? `Session ${l} · ${p.type}${p.difficultyLabel ? ` · ${p.difficultyLabel}` : ''}` : `Session ${l}`; }} contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 8px 22px rgba(11,31,58,.12)', fontSize: 12 }} />
                <ReferenceLine y={data.readiness.target} stroke="#1FA971" strokeDasharray="6 6" strokeOpacity={0.6} />
                <Line type="monotone" dataKey="structuring" stroke="#08aae4" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="quant" stroke="#ba1a1a" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="overall" stroke="#002046" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
            {data.deltaCallout && (
              <p className="text-[12px] text-secondary mt-2 leading-relaxed border-t border-outline-variant/10 pt-2">{data.deltaCallout}</p>
            )}
          </div>

          <div className="no-line-card p-4">
            <h3 className="font-headline font-bold text-sm text-primary mb-2">Skill movers</h3>
            <div>
              {data.movers.map((m) => (
                <button key={m.key} onClick={() => setDrawer({ kind: 'skill', arg: m.key })}
                  className="w-full text-left py-2.5 border-b border-outline-variant/10 last:border-0 hover:bg-surface-container-low rounded-lg px-2 -mx-2 transition">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-headline font-semibold text-[13px] text-primary flex items-center gap-2">
                      {m.label}
                      {data.progressBottleneck?.key === m.key && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-error bg-error-container/60 px-1.5 py-0.5 rounded">Bottleneck</span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-headline font-bold text-[14px] text-primary">{m.latest.toFixed(1)}</span>
                      <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded', trendCls(m.trend))}>
                        {trendIcon(m.trend)}{m.delta >= 0 ? '+' : ''}{m.delta.toFixed(1)}
                      </span>
                    </span>
                  </div>
                  <Sparkline series={m.series} color={m.trend === 'down' ? '#ba1a1a' : '#08aae4'} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── ZONE 3 · DETAILS ── */}
      {/* Weekly plan + timing summary */}
      {(ins?.weeklyPlan || data.timeSignature.length > 0) && (
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
          {ins?.weeklyPlan ? (
            <div className="no-line-card p-4">
              <h3 className="font-headline font-bold text-sm text-primary mb-2">Your plan this week</h3>
              {ins.weeklyPlan.map((p: any, i: number) => {
                const c = p.kind === 'FIX' ? 'bg-error-container/60 text-error' : p.kind === 'GROW' ? 'bg-amber-100 text-amber-700' : 'bg-tertiary-fixed text-on-tertiary-fixed-variant';
                return (
                  <div key={i} className="flex gap-3 py-2.5 border-b border-outline-variant/10 last:border-0">
                    <span className={cn('font-mono text-[10px] font-semibold px-2 py-1 rounded h-fit', c)}>{p.kind}</span>
                    <div><b className="font-headline font-semibold text-[13px] block mb-0.5">{p.title}</b><span className="text-[12px] text-secondary leading-snug">{p.detail}</span></div>
                  </div>
                );
              })}
              <Link to="/learn" className="inline-flex items-center gap-1.5 mt-3 text-[12.5px] font-semibold text-on-tertiary-container hover:underline">
                <GraduationCap className="w-3.5 h-3.5" /> Browse focus lessons →
              </Link>
            </div>
          ) : <div />}
          {data.timeSignature.length > 0 && (
            <button onClick={() => setDrawer({ kind: 'timesig' })}
              className="no-line-card p-4 text-left hover:shadow-md transition group w-full">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="font-headline font-bold text-sm text-primary">Your time signature</h3>
                <span className="text-[11px] font-mono text-on-tertiary-container group-hover:underline">View →</span>
              </div>
              <p className="text-[12px] text-secondary leading-relaxed">
                {timingOffPace > 0
                  ? <><b className="text-primary">{timingOffPace}</b> of {data.timeSignature.length} stages are off-pace — where your points leak.</>
                  : <>All {data.timeSignature.length} stages within their ideal range. Solid pacing.</>}
              </p>
            </button>
          )}
        </div>
      )}

      {/* Pattern grid (compact) */}
      <div>
        <h2 className="font-headline font-bold text-base text-primary mb-3">What the pattern says</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {/* Habits */}
          <div className="no-line-card p-4">
            <h3 className="font-headline font-bold text-sm text-primary mb-2">Habits, not slips</h3>
            {data.habits.length === 0 && <p className="text-[13px] text-secondary italic">No recurring issues flagged yet.</p>}
            {data.habits.map((h) => {
              const pct = Math.round((h.count / Math.max(1, h.total)) * 100);
              const col = pct >= 70 ? '#ba1a1a' : '#E0922F';
              return (
                <button key={h.tag} onClick={() => setDrawer({ kind: 'habit', arg: h.tag })}
                  className="w-full text-left py-2 border-b border-outline-variant/10 last:border-0 hover:bg-surface-container-low rounded-lg px-2 -mx-2 transition">
                  <div className="flex justify-between text-[12.5px] font-semibold mb-1"><span>{h.label}</span><span className="font-mono text-[11px] text-secondary">{h.count} / {h.total}</span></div>
                  <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} /></div>
                </button>
              );
            })}
          </div>

          {/* Reliability */}
          <div className="no-line-card p-4">
            <h3 className="font-headline font-bold text-sm text-primary mb-2">Reliability</h3>
            <div className="text-center">
              <div className="font-headline font-extrabold text-2xl" style={{ color: data.variance.stdev > 1.5 ? '#E0922F' : '#1FA971' }}>
                {data.variance.stdev > 1.5 ? 'Volatile' : 'Steady'}
              </div>
              <div className="text-[12px] text-secondary mt-1">Scores swing <b className="text-primary">±{data.variance.stdev.toFixed(1)} pts</b> session to session</div>
            </div>
            <div className="flex items-end justify-between gap-1 h-14 mt-3">
              {data.variance.series.map((v, i) => {
                const recent = i >= data.variance.series.length - 3;
                return <div key={i} title={`Session ${i + 1}: ${v.toFixed(1)}`} className="flex-1 rounded-t" style={{ height: `${Math.max(6, (v / 10) * 100)}%`, background: recent ? '#1FA971' : '#E0922F', opacity: recent ? 1 : 0.5 }} />;
              })}
            </div>
          </div>

          {/* Case types */}
          <div className="no-line-card p-4">
            <h3 className="font-headline font-bold text-sm text-primary mb-2">By case type</h3>
            {data.caseTypes.map((c) => (
              <button key={c.type} onClick={() => setDrawer({ kind: 'casetype', arg: c.type })}
                className="w-full flex items-center gap-2.5 py-2 border-b border-outline-variant/10 last:border-0 hover:bg-surface-container-low rounded-lg px-2 -mx-2 transition">
                <span className="text-[12.5px] w-20 shrink-0 text-left truncate">{c.label}</span>
                <div className="flex-1 h-2 bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(c.avg ?? 0) * 10}%`, background: c.avg == null ? '#9AA3B2' : c.avg >= 5.5 ? '#1FA971' : '#E0922F' }} />
                </div>
                <span className={cn('font-mono text-[11.5px] font-semibold w-8 text-right', c.avg == null && 'text-secondary/50')}>{c.avg == null ? '—' : c.avg.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Session history (compact) */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-headline font-bold text-base text-primary">Your sessions &amp; reports</h2>
          <span className="text-[12px] text-secondary">{histTotal} completed</span>
        </div>
        {history.length === 0 ? (
          <div className="no-line-card p-4 text-sm text-secondary">No completed sessions yet. Finish a case to see its report here.</div>
        ) : (
          <div className="no-line-card overflow-hidden">
            <div className="divide-y divide-outline-variant/10">
              {history.map((h) => {
                const g = h.grade ? GRADE_LABEL[h.grade] : null;
                return (
                  <button key={String(h.sessionId)} onClick={() => navigate(`/report/${h.sessionId}`)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-container-low transition text-left group">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[13px] text-primary truncate">{h.caseTitle}</p>
                      <p className="text-[11px] text-secondary truncate">
                        {prettyType(h.caseType)}{h.industry ? ` · ${prettyType(h.industry)}` : ''} · {fmtDate(h.date)}{fmtDur(h.durationSeconds) ? ` · ${fmtDur(h.durationSeconds)}` : ''}
                      </p>
                    </div>
                    {g && <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded', g.c)}>{g.t}</span>}
                    {h.score != null
                      ? <span className="font-headline font-bold text-[14px] text-primary w-12 text-right shrink-0">{(h.score / 10).toFixed(1)}<span className="text-[10px] text-secondary">/10</span></span>
                      : <span className="text-[10px] text-secondary italic w-12 text-right shrink-0">no score</span>}
                    <ArrowRight className="w-4 h-4 text-secondary group-hover:text-on-tertiary-container group-hover:translate-x-0.5 transition shrink-0" />
                  </button>
                );
              })}
            </div>
            {history.length < histTotal && (
              <button onClick={() => loadHistory(histPage + 1)} disabled={histLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-[13px] font-semibold text-on-tertiary-container border-t border-outline-variant/10 hover:bg-surface-container-low transition disabled:opacity-50">
                {histLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                {histLoading ? 'Loading…' : `Show more (${histTotal - history.length} more)`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── DRAWER ── */}
      <Drawer open={!!drawer} onClose={() => setDrawer(null)} content={drawer} data={data} navigate={navigate} evidenceFor={evidenceFor} />
    </div>
  );
}

/* ───────────────────────── Drawer ───────────────────────── */
function EvidenceCard({ e, navigate }: { e: any; navigate: any }) {
  return (
    <div className="no-line-card p-4 mb-3">
      <div className="flex items-center gap-2 text-[11px] mb-2">
        <span className="font-mono font-semibold text-on-tertiary-container">{e.timestamp}</span>
        <span className="font-mono text-secondary/70">Session {e.sess} · {e.type}</span>
        <button onClick={() => navigate(`/report/${e.sessionId}`)} className="ml-auto text-[10px] font-semibold text-on-tertiary-container hover:underline">View report →</button>
      </div>
      {e.quote && <div className="text-[13px] italic text-primary border-l-2 border-outline-variant pl-3 mb-2.5 leading-snug">“{e.quote}”</div>}
      {e.miss && <div className="text-[12.5px] flex gap-2 mb-1"><span className="font-semibold text-error shrink-0">Missed</span><span className="text-on-surface-variant">{e.miss}</span></div>}
      {e.better && <div className="text-[12.5px] flex gap-2"><span className="font-semibold text-green-700 shrink-0">Stronger</span><span className="text-on-surface-variant">{e.better}</span></div>}
    </div>
  );
}

function Drawer({ open, onClose, content, data, navigate, evidenceFor }: any) {
  const [filter, setFilter] = useState<string>('');
  useEffect(() => { setFilter(''); }, [content]);

  let title = '', kicker = 'Evidence', body: React.ReactNode = null, foot = '';
  if (content && data) {
    if (content.kind === 'evidence' || content.kind === 'habit') {
      const tag = content.kind === 'habit' ? content.arg : filter;
      const list = evidenceFor(tag || undefined);
      const habit = data.habits.find((h: any) => h.tag === content.arg);
      kicker = content.kind === 'habit' ? 'Recurring habit' : 'Root-cause evidence';
      title = content.kind === 'habit' ? (habit?.label ?? 'Habit') : (data.insight?.bottleneck?.title ?? 'Recurring evidence');
      body = (
        <>
          {content.kind === 'evidence' && data.habits.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              <button onClick={() => setFilter('')} className={cn('text-[11.5px] px-2.5 py-1 rounded-md border transition', !filter ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant/30 text-secondary')}>All</button>
              {data.habits.map((h: any) => (
                <button key={h.tag} onClick={() => setFilter(h.tag)} className={cn('text-[11.5px] px-2.5 py-1 rounded-md border transition', filter === h.tag ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant/30 text-secondary')}>{h.label}</button>
              ))}
            </div>
          )}
          {list.length === 0 ? <p className="text-sm text-secondary italic">No transcript-level moments for this yet.</p> : list.map((e: any, i: number) => <React.Fragment key={i}><EvidenceCard e={e} navigate={navigate} /></React.Fragment>)}
        </>
      );
    } else if (content.kind === 'skill') {
      const m = data.movers.find((x: any) => x.key === content.arg);
      kicker = 'Skill history'; title = m?.label ?? 'Skill';
      body = (
        <>
          <p className="text-sm text-secondary mb-4">Score per session (0–10), oldest to newest.</p>
          <div className="flex items-end gap-1.5 h-28 border-b border-outline-variant/20 pb-0">
            {(m?.series ?? []).map((v: number, i: number) => {
              const recent = i >= (m.series.length - 3);
              return <div key={i} title={`Session ${i + 1}: ${v.toFixed(1)}`} className="flex-1 rounded-t" style={{ height: `${Math.max(4, (v / 10) * 100)}%`, background: recent ? '#08aae4' : '#E4E8EF' }} />;
            })}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-secondary/70 mt-1.5"><span>S1</span><span>S{m?.series?.length ?? 1}</span></div>
        </>
      );
    } else if (content.kind === 'timesig') {
      kicker = 'Pacing'; title = 'Your time signature';
      body = (
        <>
          <p className="text-sm text-secondary mb-4 leading-relaxed">Green band = ideal range; bar = your average. The shape repeats every session — where it falls short of the band is where points leak.</p>
          <div className="space-y-3">
            {data.timeSignature.map((p: any) => {
              const lo = Number((p.ideal.match(/(\d+)\D+(\d+)/) || [])[1] || 2);
              const hi = Number((p.ideal.match(/(\d+)\D+(\d+)/) || [])[2] || 3);
              const SCALE = 8;
              const bad = /short|brief|limited|insufficient|long|shallow/i.test(p.verdict || '');
              const col = bad ? '#E0922F' : '#1FA971';
              return (
                <div key={p.stage} className="grid grid-cols-[100px_1fr_88px] items-center gap-3">
                  <span className="text-[12.5px] font-medium truncate">{p.stage}</span>
                  <div className="relative h-5 bg-surface-container-highest rounded-md overflow-hidden">
                    <div className="absolute top-0 bottom-0 bg-green-500/15 border-x-2 border-green-600" style={{ left: `${(lo / SCALE) * 100}%`, width: `${((hi - lo) / SCALE) * 100}%` }} />
                    <div className="absolute top-0.5 bottom-0.5 left-0 rounded" style={{ width: `${Math.min(100, ((p.avgMinutes ?? 0) / SCALE) * 100)}%`, background: col }} />
                  </div>
                  <span className="text-[11px] font-semibold text-right" style={{ color: col }}>{p.verdict || '—'}</span>
                </div>
              );
            })}
          </div>
        </>
      );
    } else if (content.kind === 'casetype') {
      const ct = data.caseTypes.find((c: any) => c.type === content.arg);
      const attempts = data.trajectory.filter((t: any) => t.type === ct?.label);
      kicker = 'Case type'; title = ct?.label ?? 'Case type';
      body = ct?.attempts ? (
        <>
          <p className="text-sm text-secondary mb-4">{ct.attempts} attempt{ct.attempts !== 1 ? 's' : ''}, averaging <b className="text-primary">{ct.avg?.toFixed(1)}</b>.</p>
          {attempts.map((t: any, i: number) => (
            <button key={i} onClick={() => navigate(`/report/${t.sessionId}`)} className="w-full flex items-center gap-3 py-3 border-b border-outline-variant/10 last:border-0 hover:bg-surface-container-low rounded-lg px-2 -mx-2 transition text-left">
              <span className="w-8 h-8 rounded-lg bg-surface-container border border-outline-variant/20 flex items-center justify-center font-mono font-semibold text-[13px]">{t.n}</span>
              <div className="flex-1"><b className="text-[13px] block">Session {t.n}</b><span className="text-[11.5px] text-secondary">Structuring {t.structuring?.toFixed(1) ?? '—'} · Quant {t.quant?.toFixed(1) ?? '—'}</span></div>
              <span className="font-headline font-bold text-[16px]">{t.overall.toFixed(1)}</span>
            </button>
          ))}
        </>
      ) : (
        <>
          <p className="text-sm text-secondary leading-relaxed">You've never attempted a <b className="text-primary">{ct?.label}</b> case. That's a blind spot — interviewers test it, and untested ground is risk you can remove now.</p>
          <Link to="/config" onClick={onClose} className="inline-flex items-center gap-2 mt-5 px-5 py-3 bg-primary text-on-primary font-semibold rounded-lg text-sm">Start a {ct?.label} case <ArrowRight className="w-4 h-4" /></Link>
        </>
      );
    }
  }

  return (
    <>
      <div onClick={onClose} className={cn('fixed inset-0 bg-primary/30 backdrop-blur-[1px] transition-opacity z-[60]', open ? 'opacity-100' : 'opacity-0 pointer-events-none')} />
      <aside className={cn('fixed top-0 right-0 h-screen w-[min(560px,94vw)] bg-surface-container-lowest shadow-2xl z-[61] flex flex-col transition-transform duration-300', open ? 'translate-x-0' : 'translate-x-full')}>
        <div className="p-6 border-b border-outline-variant/15 relative">
          <div className="label-blueprint text-on-tertiary-container mb-2">{kicker}</div>
          <h2 className="font-headline font-bold text-xl text-primary pr-10 leading-tight">{title}</h2>
          <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 border border-outline-variant/30 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:border-primary transition"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 overflow-y-auto scrolling-log flex-1">{body}</div>
      </aside>
    </>
  );
}
