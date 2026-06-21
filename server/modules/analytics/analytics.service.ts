import mongoose from 'mongoose';
import { Report } from '../../models/Report.js';
import { Session } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { ProgressInsight } from '../../models/ProgressInsight.js';
import { generateProgressInsight } from '../../ai/client.js';

export async function getOverview(userId: string) {
  const reports = await Report.find({ userId });

  if (reports.length === 0) {
    return {
      totalSessions: 0,
      avgOverallScore: 0,
      competencies: {
        structure: 0,
        math: 0,
        businessJudgment: 0,
        communication: 0,
        creativity: 0,
        hypothesis: 0,
      },
    };
  }

  const avg = (key: keyof typeof reports[0]['competencies']) =>
    Math.round(reports.reduce((sum, r) => sum + (r.competencies[key]?.score ?? 0), 0) / reports.length);

  return {
    totalSessions: reports.length,
    avgOverallScore: Math.round(reports.reduce((sum, r) => sum + r.overallScore, 0) / reports.length),
    competencies: {
      structure: avg('structure'),
      math: avg('math'),
      businessJudgment: avg('businessJudgment'),
      communication: avg('communication'),
      creativity: avg('creativity'),
      hypothesis: avg('hypothesis'),
    },
  };
}

export async function getTrends(userId: string, limit = 10) {
  const reports = await Report.find({ userId })
    .sort({ generatedAt: -1 })
    .limit(limit)
    .select('overallScore competencies generatedAt sessionId');

  return reports.reverse().map((r, i) => ({
    session: i + 1,
    overallScore: r.overallScore,
    structure: r.competencies.structure?.score ?? 0,
    math: r.competencies.math?.score ?? 0,
    businessJudgment: r.competencies.businessJudgment?.score ?? 0,
    communication: r.competencies.communication?.score ?? 0,
    date: r.generatedAt,
  }));
}

export async function getWeaknesses(userId: string) {
  const reports = await Report.find({ userId });
  if (reports.length === 0) return [];

  type CompetencyKey = 'structure' | 'math' | 'businessJudgment' | 'communication' | 'creativity' | 'hypothesis';
  const keys: CompetencyKey[] = ['structure', 'math', 'businessJudgment', 'communication', 'creativity', 'hypothesis'];

  const scores = keys.map((key) => ({
    name: key,
    avg: Math.round(reports.reduce((sum, r) => sum + (r.competencies[key]?.score ?? 0), 0) / reports.length),
  }));

  return scores.sort((a, b) => a.avg - b.avg).slice(0, 3);
}

export async function getHistory(userId: string, page = 1, limit = 10) {
  const skip = (page - 1) * limit;

  const sessions = await Session.find({ userId, status: 'completed' })
    .populate('caseId', 'title type industry difficulty')
    .sort({ startedAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Session.countDocuments({ userId, status: 'completed' });

  const sessionIds = sessions.map((s) => s._id);
  const reports = await Report.find({ sessionId: { $in: sessionIds } }).select('sessionId overallScore overallGrade');

  const reportMap = new Map(reports.map((r) => [r.sessionId.toString(), r]));

  const history = sessions.map((s) => {
    const caseDoc = s.caseId as unknown as InstanceType<typeof Case>;
    const report = reportMap.get(s._id.toString());
    return {
      sessionId: s._id,
      caseTitle: caseDoc?.title ?? 'Unknown Case',
      caseType: caseDoc?.type ?? s.config.caseType,
      industry: caseDoc?.industry ?? s.config.industry,
      status: s.status,
      score: report?.overallScore ?? null,
      grade: report?.overallGrade ?? null,
      durationSeconds: s.durationSeconds ?? null,
      date: s.startedAt,
    };
  });

  return { history, total, page, limit };
}

/* ─────────────────────────── Dashboard intelligence ─────────────────────────── */
/* eslint-disable @typescript-eslint/no-explicit-any */

const HABIT_LABELS: Record<string, string> = {
  rush_structuring: 'Rushed structuring phase',
  invent_number: 'Unvalidated assumptions',
  skip_validation: 'Skipped validation',
  clarity: 'Communication breaks down',
  no_hypothesis: 'No hypothesis-first thinking',
  shallow_risk: 'Shallow risk analysis',
  weak_synthesis: 'Weak synthesis / close',
};

// Display skills → (rich competency key, legacy competency key)
const MOVER_SKILLS: Array<{ key: string; label: string; rich: string; legacy: string }> = [
  { key: 'Structuring', label: 'Structuring', rich: 'structuring', legacy: 'structure' },
  { key: 'Quant', label: 'Quantitative', rich: 'quantitative', legacy: 'math' },
  { key: 'Judgment', label: 'Business judgment', rich: 'businessJudgment', legacy: 'businessJudgment' },
  { key: 'Comm', label: 'Communication', rich: 'communication', legacy: 'communication' },
];

const ALL_CASE_TYPES = ['profitability', 'market_entry', 'ma', 'growth', 'pricing', 'operations'];
const CASE_TYPE_LABELS: Record<string, string> = {
  profitability: 'Profitability', market_entry: 'Market Entry', ma: 'M&A',
  growth: 'Growth', pricing: 'Pricing', operations: 'Operations',
};

const READINESS_BANDS = (s: number) =>
  s >= 8 ? 'Strong candidate' : s >= 7 ? 'Interview ready' : s >= 5 ? 'Needs practice' : 'Not ready';

function overall10(r: any): number {
  const s = r.analysis?.overall?.score;
  return typeof s === 'number' ? s : (r.overallScore ?? 0) / 10;
}
function compScore10(r: any, rich: string, legacy: string): number | null {
  const c = (r.analysis?.competencies as any[] | undefined)?.find((x) => x?.key === rich);
  if (typeof c?.score === 'number') return c.score;
  const lg = r.competencies?.[legacy]?.score;
  return typeof lg === 'number' ? lg / 10 : null;
}
function parseMinutes(str?: string): number | null {
  if (!str) return null;
  const m = str.match(/(\d+):(\d{1,2})/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const only = str.match(/(\d+(\.\d+)?)/);
  return only ? Number(only[1]) : null;
}
function trendOf(series: number[]): 'up' | 'flat' | 'down' {
  if (series.length < 2) return 'flat';
  const d = series[series.length - 1] - series[Math.max(0, series.length - 4)];
  return d > 0.4 ? 'up' : d < -0.4 ? 'down' : 'flat';
}
// Trailing flat-run length: how many consecutive recent sessions stayed within
// ~0.5 of the latest score. A run >= 3 is a plateau (spec §9 bottleneck).
function trailingFlat(series: number[]): number {
  if (series.length === 0) return 0;
  const last = series[series.length - 1];
  let run = 1;
  for (let i = series.length - 2; i >= 0; i--) {
    if (Math.abs(series[i] - last) <= 0.5) run++; else break;
  }
  return run;
}

export async function getDashboard(userId: string) {
  // Reports oldest → newest, joined with their session (case type + date).
  const reports = await Report.find({ userId }).sort({ generatedAt: 1 });
  const sessions = await Session.find({ userId }).populate('caseId', 'title type');
  const sessById = new Map(sessions.map((s) => [s._id.toString(), s]));

  const rows = reports.map((r) => {
    const sess = sessById.get(r.sessionId.toString());
    const caseDoc = sess?.caseId as unknown as InstanceType<typeof Case> | undefined;
    return {
      report: r as any,
      type: caseDoc?.type ?? (sess?.config?.caseType) ?? 'unknown',
      title: caseDoc?.title ?? 'Case',
      difficulty: sess?.config?.difficulty ?? null,
      date: r.generatedAt,
      sessionId: r.sessionId.toString(),
    };
  });

  const n = rows.length;
  const overallSeries = rows.map((x) => overall10(x.report));

  // Trajectory
  const DIFFICULTY_SHORT: Record<number, string> = { 1: 'Beg', 2: 'Int', 3: 'Adv', 4: 'Exp' };
  const trajectory = rows.map((x, i) => ({
    n: i + 1,
    date: x.date,
    type: CASE_TYPE_LABELS[x.type] ?? x.type,
    difficulty: x.difficulty,
    difficultyLabel: x.difficulty ? (DIFFICULTY_SHORT[x.difficulty] ?? `L${x.difficulty}`) : '',
    overall: Math.round(overall10(x.report) * 10) / 10,
    structuring: compScore10(x.report, 'structuring', 'structure'),
    quant: compScore10(x.report, 'quantitative', 'math'),
    sessionId: x.sessionId,
  }));

  // Movers (per-skill series, latest, delta, trend, plateau run)
  const movers = MOVER_SKILLS.map((sk) => {
    const series = rows.map((x) => compScore10(x.report, sk.rich, sk.legacy) ?? 0);
    const latest = series[series.length - 1] ?? 0;
    const prior = series[Math.max(0, series.length - 4)] ?? latest;
    return {
      key: sk.key, label: sk.label, latest: Math.round(latest * 10) / 10,
      delta: Math.round((latest - prior) * 10) / 10, trend: trendOf(series),
      plateau: trailingFlat(series), series,
    };
  });

  // Progress bottleneck (spec §9): the single dimension stuck the longest at the
  // same level (>= 3 sessions), tie-broken by lowest score. Plus a deterministic
  // narrative delta callout for under the trajectory chart.
  const plateaued = movers.filter((m) => m.plateau >= 3).sort((a, b) => b.plateau - a.plateau || a.latest - b.latest);
  const progressBottleneck = plateaued[0]
    ? { key: plateaued[0].key, label: plateaued[0].label, score: plateaued[0].latest, sessions: plateaued[0].plateau }
    : null;
  let deltaCallout = '';
  if (n >= 3) {
    const improver = [...movers].sort((a, b) => b.delta - a.delta)[0];
    const parts: string[] = [];
    if (improver && improver.delta >= 0.4) parts.push(`${improver.label} is up +${improver.delta.toFixed(1)} over your recent sessions`);
    if (progressBottleneck) parts.push(`${progressBottleneck.label} has been flat at ${progressBottleneck.score.toFixed(1)} for ${progressBottleneck.sessions} sessions — your current bottleneck`);
    deltaCallout = parts.length ? parts.join('; ') + '.' : '';
  }

  // By case type
  const caseTypes = ALL_CASE_TYPES.map((t) => {
    const attempts = rows.filter((x) => x.type === t);
    const scores = attempts.map((x) => overall10(x.report));
    return {
      type: t, label: CASE_TYPE_LABELS[t], attempts: attempts.length,
      avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      last: scores.length ? Math.round(scores[scores.length - 1] * 10) / 10 : null,
    };
  });

  // Variance / reliability
  const mean = overallSeries.length ? overallSeries.reduce((a, b) => a + b, 0) / overallSeries.length : 0;
  const stdev = overallSeries.length
    ? Math.sqrt(overallSeries.reduce((a, b) => a + (b - mean) ** 2, 0) / overallSeries.length) : 0;
  const variance = { series: overallSeries.map((v) => Math.round(v * 10) / 10), mean: Math.round(mean * 10) / 10, stdev: Math.round(stdev * 10) / 10 };

  // Time signature (avg minutes per phase from analysis.timeManagement)
  const phaseAgg = new Map<string, { total: number; count: number; ideal?: string; verdict?: string }>();
  const phaseOrder: string[] = [];
  for (const x of rows) {
    for (const t of (x.report.analysis?.timeManagement as any[] | undefined) ?? []) {
      const stage = t.stage as string;
      if (!stage) continue;
      const mins = parseMinutes(t.timeSpent);
      if (!phaseAgg.has(stage)) { phaseAgg.set(stage, { total: 0, count: 0, ideal: t.recommended, verdict: t.assessment }); phaseOrder.push(stage); }
      const agg = phaseAgg.get(stage)!;
      if (mins != null) { agg.total += mins; agg.count++; }
      agg.verdict = t.assessment ?? agg.verdict;
    }
  }
  const timeSignature = phaseOrder.map((stage) => {
    const a = phaseAgg.get(stage)!;
    return { stage, avgMinutes: a.count ? Math.round((a.total / a.count) * 100) / 100 : null, ideal: a.ideal ?? '', verdict: a.verdict ?? '' };
  });

  // Habits: distinct sessions per habitTag
  const habitSessions = new Map<string, Set<number>>();
  const evidence: any[] = [];
  rows.forEach((x, i) => {
    for (const m of (x.report.analysis?.missedOpportunities as any[] | undefined) ?? []) {
      const tag = (m.habitTag as string) || 'clarity';
      if (!habitSessions.has(tag)) habitSessions.set(tag, new Set());
      habitSessions.get(tag)!.add(i);
      evidence.push({
        sess: i + 1, date: x.date, type: CASE_TYPE_LABELS[x.type] ?? x.type, sessionId: x.sessionId,
        timestamp: m.timestamp, habitTag: tag,
        // v2 four-part shape (setup/yourMove/gap/practicePattern); fall back to v1.
        quote: m.yourMove ?? m.candidateResponse,
        miss: m.gap ?? m.missed,
        better: m.practicePattern ?? m.better,
      });
    }
  });
  const habits = [...habitSessions.entries()]
    .map(([tag, set]) => ({ tag, label: HABIT_LABELS[tag] ?? tag, count: set.size, total: n }))
    .sort((a, b) => b.count - a.count);

  // Readiness
  const latestOverall = overallSeries[overallSeries.length - 1] ?? 0;
  const delta3 = overallSeries.length >= 2 ? latestOverall - overallSeries[Math.max(0, overallSeries.length - 4)] : 0;
  const firstDate = rows[0]?.date ? new Date(rows[0].date).getTime() : Date.now();
  const weeksSpan = Math.max(1, Math.round((Date.now() - firstDate) / (1000 * 60 * 60 * 24 * 7)));
  const readiness = {
    overall: Math.round(latestOverall * 10) / 10,
    delta3: Math.round(delta3 * 10) / 10,
    band: READINESS_BANDS(latestOverall),
    target: 7,
  };

  const insight = await getOrGenerateInsight(userId, {
    sessionCount: n, weeksSpan, latestOverall, delta3, trajectory, movers, habits, caseTypes,
  });

  return { totals: { sessions: n, weeks: weeksSpan }, readiness, trajectory, movers, progressBottleneck, deltaCallout, caseTypes, variance, timeSignature, habits, evidence, insight };
}

// Cached cross-session narrative; regenerated only when report count changes.
async function getOrGenerateInsight(userId: string, agg: any): Promise<Record<string, unknown> | null> {
  if (agg.sessionCount < 3) return null; // cold start — dashboard shows an "unlock" state

  const cached = await ProgressInsight.findOne({ userId });
  if (cached && cached.reportCount === agg.sessionCount) return cached.insight;

  try {
    const competencyTrends = (agg.movers as any[]).map((m) => ({ skill: m.label, latest: m.latest, trend: m.trend }));
    const untestedCaseTypes = (agg.caseTypes as any[]).filter((c) => c.attempts === 0).map((c) => c.label);
    const best = (agg.caseTypes as any[]).filter((c) => c.avg != null).sort((a, b) => b.avg - a.avg)[0];

    const insight = await generateProgressInsight({
      sessionCount: agg.sessionCount,
      weeksSpan: agg.weeksSpan,
      latestOverall: agg.latestOverall,
      delta3: agg.delta3,
      trajectory: (agg.trajectory as any[]).map((t) => t.overall),
      competencyTrends,
      habits: (agg.habits as any[]).map((h) => ({ tag: h.tag, label: h.label, count: h.count, total: h.total })),
      bestCaseType: best?.label ?? null,
      untestedCaseTypes,
    });

    await ProgressInsight.findOneAndUpdate(
      { userId },
      { userId, reportCount: agg.sessionCount, insight, generatedAt: new Date() },
      { upsert: true }
    );
    return insight;
  } catch (err) {
    console.error('progress insight generation failed:', err);
    return cached?.insight ?? null; // fall back to stale or null; charts still render
  }
}
