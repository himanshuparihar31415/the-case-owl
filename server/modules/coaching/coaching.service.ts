import { Report } from '../../models/Report.js';
import { Session } from '../../models/Session.js';
import { LessonView } from '../../models/LessonView.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The 7 canonical habits (mirrors analytics HABIT_LABELS) plus the editorial
// framing and the matchers used to pull LIVE exemplars out of stored reports.
//   skillMatch → which idealAnswers[].skillTested count as a model example
//   stageMatch → which timeManagement[].stage measures this habit (loop closure)
export const HABIT_META: Record<string, {
  label: string; skill: string; intro: string; skillMatch: RegExp; stageMatch: RegExp;
}> = {
  rush_structuring: {
    label: 'Rushed structuring phase',
    skill: 'Structuring',
    intro: 'Strong candidates spend real time up front building a clean, MECE structure before diving in. These are model structuring moments pulled from real cases on the platform — notice the framework stated up front and why each one holds together.',
    skillMatch: /structur|framework|mece|approach|break.?down/i,
    stageMatch: /structur|framework|approach/i,
  },
  no_hypothesis: {
    label: 'No hypothesis-first thinking',
    skill: 'Hypothesis-first thinking',
    intro: 'Top candidates lead with a hypothesis, then let it drive which questions they ask and which data they seek. These are model moments where a hypothesis came first and shaped the path.',
    skillMatch: /hypothes/i,
    stageMatch: /hypothes|analy/i,
  },
  weak_synthesis: {
    label: 'Weak synthesis / close',
    skill: 'Synthesis',
    intro: 'A strong close ties findings into a 30-second recommendation with quantified impact, the key risk, and next steps. Study how these model recommendations land.',
    skillMatch: /synth|recommend|conclu|close|so.?what/i,
    stageMatch: /synth|recommend|conclu|close/i,
  },
  invent_number: {
    label: 'Unvalidated assumptions',
    skill: 'Grounded assumptions',
    intro: 'Instead of inventing a number, strong candidates state the assumption out loud, anchor it to something real, and flag it for validation. See how these model answers source their numbers.',
    skillMatch: /assumpt|estimat|number|quant|math|driver/i,
    stageMatch: /quant|analy|math/i,
  },
  skip_validation: {
    label: 'Skipped validation',
    skill: 'Validation & sanity-checks',
    intro: 'Every number and every conclusion deserves a sanity check. These model moments show candidates validating a result before moving on.',
    skillMatch: /valid|sanity|check|reasonab|plausib/i,
    stageMatch: /quant|synth|analy/i,
  },
  shallow_risk: {
    label: 'Shallow risk analysis',
    skill: 'Risk analysis',
    intro: 'A recommendation with no risks reads as naive. See how model answers surface the real downside risks and how they would mitigate them.',
    skillMatch: /risk|downside|mitigat|tradeoff/i,
    stageMatch: /synth|recommend|risk/i,
  },
  clarity: {
    label: 'Communication breaks down',
    skill: 'Structured communication',
    intro: 'Interviewers reward top-down, signposted answers: the headline first, then the supporting logic. These model answers show that shape in action.',
    skillMatch: /communicat|clar|top.?down|signpost|concise|structure/i,
    stageMatch: /./,
  },
};

export const HABIT_TAGS = Object.keys(HABIT_META);

// Sample the most recent N reports globally when building lesson content. We
// only ever read AI-generated fields (modelAnswer / practicePattern), never a
// candidate's own words, so cross-user aggregation stays privacy-safe.
const SAMPLE_LIMIT = 300;
const EXEMPLARS_PER_LESSON = 6;
const EXEMPLARS_PER_CASE_TYPE = 2;
const DRILLS_PER_LESSON = 5;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const prettyType = (t: string) =>
  (t || 'Case').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

function parseMinutes(str?: string): number | null {
  if (!str) return null;
  const m = String(str).match(/(\d+):(\d{1,2})/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const only = String(str).match(/(\d+(\.\d+)?)/);
  return only ? Number(only[1]) : null;
}
function fmtMin(v: number | null): string | null {
  if (v == null) return null;
  const mm = Math.floor(v);
  const ss = Math.round((v - mm) * 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export interface Exemplar { caseType: string; skillTested: string; question: string; modelAnswer: string; }
export interface LessonPayload {
  habitTag: string; label: string; skill: string; intro: string;
  drills: string[]; exemplars: Exemplar[];
  stats: { reportsAnalyzed: number; exemplarCount: number; drillCount: number };
}

// Build a single lesson from live session data, keyed by habit.
export async function getLesson(habitTag: string): Promise<LessonPayload | null> {
  const meta = HABIT_META[habitTag];
  if (!meta) return null;

  const reports = await Report.find({}, { analysis: 1, sessionId: 1 })
    .sort({ generatedAt: -1 }).limit(SAMPLE_LIMIT).lean();

  // Resolve case type per report (for exemplar variety) via the session.
  const sessionIds = reports.map((r: any) => r.sessionId).filter(Boolean);
  const sessions = await Session.find({ _id: { $in: sessionIds } }, { config: 1 })
    .populate('caseId', 'type').lean();
  const caseTypeBySession = new Map<string, string>();
  for (const s of sessions as any[]) {
    caseTypeBySession.set(String(s._id), prettyType(s.config?.caseType || (s.caseId as any)?.type));
  }

  const drillSeen = new Set<string>();
  const drills: string[] = [];
  const exemplars: Exemplar[] = [];
  const perCaseType = new Map<string, number>();

  for (const r of reports as any[]) {
    const a = r.analysis || {};
    const caseType = caseTypeBySession.get(String(r.sessionId)) || 'Case';

    for (const m of (a.missedOpportunities as any[] | undefined) ?? []) {
      if (m?.habitTag !== habitTag) continue;
      const p = String(m.practicePattern || '').trim();
      if (p && !drillSeen.has(norm(p))) { drillSeen.add(norm(p)); drills.push(p); }
    }

    for (const q of (a.idealAnswers as any[] | undefined) ?? []) {
      const model = String(q?.modelAnswer || '').trim();
      if (!model) continue;
      const skill = String(q?.skillTested || '');
      const question = String(q?.question || '');
      if (!meta.skillMatch.test(skill) && !meta.skillMatch.test(question)) continue;
      const seen = perCaseType.get(caseType) ?? 0;
      if (seen >= EXEMPLARS_PER_CASE_TYPE) continue; // keep variety across case types
      perCaseType.set(caseType, seen + 1);
      exemplars.push({ caseType, skillTested: skill || meta.skill, question, modelAnswer: model });
    }
  }

  return {
    habitTag,
    label: meta.label,
    skill: meta.skill,
    intro: meta.intro,
    drills: drills.slice(0, DRILLS_PER_LESSON),
    exemplars: exemplars.slice(0, EXEMPLARS_PER_LESSON),
    stats: {
      reportsAnalyzed: reports.length,
      exemplarCount: Math.min(exemplars.length, EXEMPLARS_PER_LESSON),
      drillCount: Math.min(drills.length, DRILLS_PER_LESSON),
    },
  };
}

// The lesson library index + which habit is THIS user's top bottleneck.
export async function getLessonIndex(userId: string): Promise<{
  lessons: Array<{ habitTag: string; label: string; skill: string; intro: string; yourCount: number }>;
  topHabit: string | null;
}> {
  const reports = await Report.find({ userId }, { analysis: 1 }).lean();
  const counts = new Map<string, number>();
  for (const r of reports as any[]) {
    for (const m of (r.analysis?.missedOpportunities as any[] | undefined) ?? []) {
      const t = m?.habitTag;
      if (t && HABIT_META[t]) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const topHabit = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const lessons = HABIT_TAGS.map((tag) => ({
    habitTag: tag,
    label: HABIT_META[tag].label,
    skill: HABIT_META[tag].skill,
    intro: HABIT_META[tag].intro,
    yourCount: counts.get(tag) ?? 0,
  }));
  return { lessons, topHabit };
}

export async function recordView(userId: string, habitTag?: string): Promise<void> {
  if (!habitTag || !HABIT_META[habitTag]) return;
  await LessonView.create({ userId, habitTag, viewedAt: new Date() });
}

export interface LoopCallback {
  habitTag: string; label: string; skill: string;
  stage: string | null;
  thisLabel: string | null; priorLabel: string | null;
  deltaMinutes: number | null; assessment: string | null;
}

// Did the user review a lesson before this session? If so, measure how the
// matching stage's timing compares to their prior baseline. Null when there's
// no lesson view in the 14 days before the session started.
export async function getLoopCallback(userId: string, sessionId: string): Promise<LoopCallback | null> {
  const session = await Session.findOne({ _id: sessionId, userId }, { startedAt: 1 }).lean() as any;
  if (!session) return null;
  const report = await Report.findOne({ sessionId }, { analysis: 1, generatedAt: 1 }).lean() as any;
  if (!report) return null;

  const startedAt: Date = session.startedAt;
  const since = new Date(new Date(startedAt).getTime() - 14 * 24 * 3600 * 1000);
  const view = await LessonView.findOne({
    userId, viewedAt: { $gte: since, $lte: startedAt },
  }).sort({ viewedAt: -1 }).lean() as any;
  if (!view) return null;

  const meta = HABIT_META[view.habitTag];
  if (!meta) return null;

  const tm = (report.analysis?.timeManagement as any[] | undefined) ?? [];
  const stage = tm.find((t) => meta.stageMatch.test(String(t?.stage || '')));
  const thisMinutes = stage ? parseMinutes(stage.timeSpent) : null;

  const priorReports = await Report.find(
    { userId, generatedAt: { $lt: report.generatedAt ?? new Date() } },
    { analysis: 1 }
  ).sort({ generatedAt: -1 }).limit(10).lean();
  const priorVals: number[] = [];
  for (const r of priorReports as any[]) {
    for (const t of (r.analysis?.timeManagement as any[] | undefined) ?? []) {
      if (meta.stageMatch.test(String(t?.stage || ''))) {
        const m = parseMinutes(t.timeSpent);
        if (m != null) priorVals.push(m);
      }
    }
  }
  const priorAvg = priorVals.length ? priorVals.reduce((a, b) => a + b, 0) / priorVals.length : null;

  return {
    habitTag: view.habitTag,
    label: meta.label,
    skill: meta.skill,
    stage: stage?.stage ?? null,
    thisLabel: fmtMin(thisMinutes),
    priorLabel: fmtMin(priorAvg),
    deltaMinutes: thisMinutes != null && priorAvg != null ? Math.round((thisMinutes - priorAvg) * 100) / 100 : null,
    assessment: stage?.assessment ?? null,
  };
}
