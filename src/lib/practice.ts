/* Client-side derivations for the Dashboard practice cockpit.
   Everything here is computed from data the existing analytics endpoints already return. */

export interface HistoryItem {
  sessionId: string; caseTitle: string; caseType?: string; industry?: string;
  status: string; score: number | null; grade: string | null; durationSeconds: number | null; date: string;
  company?: string; // not returned by the API today; the history table shows the column only if it ever is
}

export type InterviewModule = 'case' | 'product' | 'guesstimate';
export type InterviewType = 'Case' | 'Product' | 'Guesstimate' | 'GD' | 'Resume' | 'General';

/** Mirrors how Config encodes the module into caseType: 'guesstimate', 'product:<format>', else a case archetype. */
export function interviewTypeOf(caseType?: string): InterviewType {
  const t = (caseType ?? '').toLowerCase();
  if (t === 'guesstimate') return 'Guesstimate';
  if (t.startsWith('product')) return 'Product';
  if (t === 'gd' || t.startsWith('group')) return 'GD';
  if (t.startsWith('resume')) return 'Resume';
  if (t.startsWith('general')) return 'General';
  return 'Case';
}

export function moduleOf(caseType?: string): InterviewModule {
  const t = interviewTypeOf(caseType);
  return t === 'Guesstimate' ? 'guesstimate' : t === 'Product' ? 'product' : 'case';
}

/* ───────────── streaks + heatmap ───────────── */

export const WEEKLY_GOAL = 3; // reps per week — local constant, no backend

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Whole-day index in local calendar terms (immune to DST shifts). */
const dayIndex = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

export function countByDay(rows: Array<{ date: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKey(d);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function computeStreaks(counts: Map<string, number>, today = new Date()) {
  const days = [...counts.keys()].map((k) => {
    const [y, mo, d] = k.split('-').map(Number);
    return dayIndex(new Date(y, mo - 1, d));
  }).sort((a, b) => a - b);

  let longest = 0, run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d - days[i - 1] === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });

  // The streak stays alive through today: it only breaks once a whole day passes with no rep.
  const set = new Set(days);
  const t = dayIndex(today);
  const activeToday = set.has(t);
  let cursor = activeToday ? t : t - 1;
  let current = 0;
  while (set.has(cursor)) { current++; cursor--; }

  return { current, longest, activeToday };
}

export function thisWeekCount(counts: Map<string, number>, today = new Date()) {
  const start = mondayOf(today);
  let n = 0;
  for (let i = 0; i < 7; i++) n += counts.get(dayKey(addDays(start, i))) ?? 0;
  return n;
}

export interface HeatCell { key: string; date: Date; count: number; future: boolean }

/** `weeks` columns (Mon-first), ending with the current week. */
export function buildHeatmap(counts: Map<string, number>, weeks: number, today = new Date()): HeatCell[][] {
  const start = addDays(mondayOf(today), -(weeks - 1) * 7);
  const todayIdx = dayIndex(today);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      const key = dayKey(date);
      return { key, date, count: counts.get(key) ?? 0, future: dayIndex(date) > todayIdx };
    }));
}

export const heatLevel = (count: number) => (count <= 0 ? 0 : Math.min(4, count));

/* ───────────── prep plan ───────────── */

export interface DashLite {
  totals: { sessions: number };
  readiness: { overall: number; target: number };
  movers: Array<{ key: string; label: string; latest: number; delta: number; trend: string }>;
  caseTypes: Array<{ type: string; label: string; attempts: number; avg: number | null }>;
  habits: Array<{ tag: string; label: string; count: number; total: number }>;
  progressBottleneck: { key: string; label: string; score: number; sessions: number } | null;
  trajectory: Array<{ sessionId: string; difficulty: number | null; overall: number }>;
}

export interface PlanItem {
  id: string;
  kind: 'FIX' | 'GROW' | 'EXPLORE';
  focus: string;
  reason: string;
  module: InterviewModule;
  archetype?: string; // case type id Config can preselect
}

/** 3–5 next reps, each backed by a number the analytics endpoint already returned. */
export function buildPrepPlan(d: DashLite, module: InterviewModule): PlanItem[] {
  if (d.totals.sessions < 1) return [];
  const bar = d.readiness.target;
  const items: PlanItem[] = [];
  const usedSkills = new Set<string>();
  const f1 = (n: number) => n.toFixed(1);

  const bn = d.progressBottleneck;
  if (bn) {
    usedSkills.add(bn.key);
    items.push({ id: `bn-${bn.key}`, kind: 'FIX', focus: `Break the ${bn.label} plateau`, reason: `${bn.label} has sat at ${f1(bn.score)}/10 for ${bn.sessions} sessions in a row.`, module });
  }

  for (const m of d.movers.filter((x) => x.trend === 'down' && !usedSkills.has(x.key))) {
    usedSkills.add(m.key);
    items.push({ id: `down-${m.key}`, kind: 'FIX', focus: `Recover your ${m.label}`, reason: `${m.label} slipped ${f1(Math.abs(m.delta))} points across your last 3 sessions, now ${f1(m.latest)}/10.`, module });
  }

  const weakest = d.movers.filter((x) => !usedSkills.has(x.key) && x.latest < bar).sort((a, b) => a.latest - b.latest)[0];
  if (weakest) {
    usedSkills.add(weakest.key);
    items.push({ id: `weak-${weakest.key}`, kind: 'GROW', focus: `Raise your ${weakest.label}`, reason: `You're at ${f1(weakest.latest)}/10. Firms look for about ${bar}.`, module });
  }

  const weakType = d.caseTypes.filter((c) => c.attempts > 0 && c.avg != null && c.avg < bar).sort((a, b) => (a.avg ?? 0) - (b.avg ?? 0))[0];
  if (weakType) {
    items.push({ id: `type-${weakType.type}`, kind: 'GROW', focus: `Drill ${weakType.label} cases`, reason: `${weakType.label} averages ${f1(weakType.avg ?? 0)}/10 over ${weakType.attempts} attempt${weakType.attempts === 1 ? '' : 's'}.`, module: 'case', archetype: weakType.type });
  }

  for (const c of d.caseTypes.filter((x) => x.attempts === 0).slice(0, 2)) {
    items.push({ id: `new-${c.type}`, kind: 'EXPLORE', focus: `Try a ${c.label} case`, reason: `You've never run one. Interviewers will ask.`, module: 'case', archetype: c.type });
  }

  return items.slice(0, 5);
}

/* ───────────── history table model ───────────── */

export const DIFFICULTY_LABEL: Record<number, string> = { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert' };

export interface HistoryRow extends HistoryItem {
  type: InterviewType;
  difficulty: number | null;
  ts: number;
}

export function buildHistoryRows(history: HistoryItem[], trajectory: DashLite['trajectory']): HistoryRow[] {
  const diff = new Map(trajectory.map((t) => [String(t.sessionId), t.difficulty]));
  return history
    .map((h) => ({ ...h, type: interviewTypeOf(h.caseType), difficulty: diff.get(String(h.sessionId)) ?? null, ts: new Date(h.date).getTime() }))
    .sort((a, b) => b.ts - a.ts);
}
