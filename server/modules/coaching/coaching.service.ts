import { Report } from '../../models/Report.js';
import { Session } from '../../models/Session.js';
import { LessonView } from '../../models/LessonView.js';
import { HABIT_META, HABITS_BY_MODULE, normalizeHabitModule, type HabitModule } from '../../ai/habits.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ModuleId = HabitModule;
export interface Framework { name: string; idea: string }

export const MODULES: Array<{ id: ModuleId; label: string; blurb: string }> = [
  { id: 'case', label: 'Consulting', blurb: 'Profitability, market entry, M&A, pricing — structure, quant & synthesis.' },
  { id: 'product', label: 'Product', blurb: 'PM interviews — design, strategy, root-cause, prioritization & metrics.' },
  { id: 'guesstimate', label: 'Guesstimate', blurb: 'Market-sizing & estimation — decomposition, assumptions, sanity-checks.' },
];

const normalizeModule = normalizeHabitModule;

// General frameworks per broader category — the "what good structure looks like"
// toolkit shown across that category's lessons.
export const MODULE_FRAMEWORKS: Record<ModuleId, Framework[]> = {
  case: [
    { name: 'Profitability tree', idea: 'Profit = Revenue − Cost. Split revenue (price × volume) and cost (fixed vs. variable) into drivers before touching numbers.' },
    { name: 'Market entry', idea: 'Market attractiveness → competition → your capability → economics & entry mode. Decide the question order before you ask.' },
    { name: 'M&A / deal', idea: 'Standalone value → synergies (revenue & cost) → price & risks → integration plan.' },
    { name: 'Pricing', idea: 'Triangulate three lenses: cost-plus, competitor benchmark, and customer willingness-to-pay.' },
    { name: 'Pyramid principle', idea: 'Answer first, then the three supporting reasons, then the detail. Never make them wait for your conclusion.' },
  ],
  product: [
    { name: 'CIRCLES (design)', idea: 'Comprehend → Identify user → Report needs → Cut/prioritize → List solutions → Evaluate → Summarize.' },
    { name: 'Users & JTBD', idea: 'Segment users, then state the job each is "hiring" the product to do. Design for the job, not the demographic.' },
    { name: 'RICE prioritization', idea: 'Score ideas by Reach × Impact × Confidence ÷ Effort so tradeoffs are explicit and defensible.' },
    { name: 'Metrics (AARRR)', idea: 'Acquisition → Activation → Retention → Referral → Revenue. Pick the one metric that moves the stated goal.' },
    { name: 'Root-cause (funnel)', idea: 'Walk the funnel step by step to localize where the metric actually drops before proposing fixes.' },
  ],
  guesstimate: [
    { name: 'Top-down decomposition', idea: 'Start from a big known population and narrow it with rates (penetration, frequency).' },
    { name: 'Bottom-up build', idea: 'Build from a single unit (per store / per person / per day) and scale up.' },
    { name: 'Segmentation', idea: 'Split the population into groups that behave differently, size each, then sum.' },
    { name: 'Population × rate', idea: 'Quantity = population × penetration × frequency × unit size. State each factor out loud.' },
    { name: 'Sanity check', idea: 'Compare your answer to a known benchmark; if it is off by an order of magnitude, find the bad assumption.' },
  ],
};

// Habit taxonomy (labels, framing, matchers) is shared — see ../../ai/habits.
export const HABIT_TAGS = Object.keys(HABIT_META);

// Curated further reading — stable, reputable sources shown across lessons.
export const RESOURCES: Array<{ label: string; detail: string; url: string }> = [
  { label: 'Victor Cheng — Case Interview Fundamentals', detail: 'The classic frameworks-and-fundamentals primer.', url: 'https://www.caseinterview.com/' },
  { label: 'Management Consulted — Case Guide', detail: 'Frameworks, math drills, and worked examples.', url: 'https://managementconsulted.com/' },
  { label: 'RocketBlocks — Skill Drills', detail: 'Targeted structuring, math, and synthesis practice.', url: 'https://www.rocketblocks.me/' },
  { label: 'McKinsey — Interview Prep', detail: 'What top firms actually look for in the room.', url: 'https://www.mckinsey.com/careers/interviewing' },
];

// Sample the most recent N reports globally when building lesson content. We
// only ever read AI-generated fields (modelAnswer / practicePattern), never a
// candidate's own words, so cross-user aggregation stays privacy-safe.
const SAMPLE_LIMIT = 300;
const EXEMPLARS_PER_LESSON = 6;
const EXEMPLARS_PER_CASE_TYPE = 2;
const DRILLS_PER_LESSON = 5;

// In-memory cache of built lessons, keyed by `${habitTag}:${module}`. Content
// only changes when a new report is written, so we invalidate on report
// generation (see reports.service) and keep a TTL as a backstop.
const lessonCache = new Map<string, { payload: LessonPayload; at: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000;
export function invalidateLessonCache(): void { lessonCache.clear(); }

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
  habitTag: string; module: ModuleId; label: string; skill: string; intro: string;
  frameworks: Framework[];
  drills: string[]; exemplars: Exemplar[];
  resources: typeof RESOURCES;
  stats: { reportsAnalyzed: number; exemplarCount: number; drillCount: number };
}

// Build a single lesson from live session data, scoped to a broader category.
export async function getLesson(habitTag: string, moduleArg?: string): Promise<LessonPayload | null> {
  const meta = HABIT_META[habitTag];
  if (!meta) return null;
  const module = normalizeModule(moduleArg);

  const cacheKey = `${habitTag}:${module}`;
  const cached = lessonCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;

  const reports = await Report.find({}, { analysis: 1, sessionId: 1 })
    .sort({ generatedAt: -1 }).limit(SAMPLE_LIMIT).lean();

  // Resolve module + case type per report (via the session) for filtering & labels.
  const sessionIds = reports.map((r: any) => r.sessionId).filter(Boolean);
  const sessions = await Session.find({ _id: { $in: sessionIds } }, { config: 1, interviewType: 1 })
    .populate('caseId', 'type module').lean();
  const metaBySession = new Map<string, { module: ModuleId; caseType: string }>();
  for (const s of sessions as any[]) {
    const mod = normalizeModule((s.caseId as any)?.module || s.interviewType || s.config?.caseType);
    metaBySession.set(String(s._id), { module: mod, caseType: prettyType(s.config?.caseType || (s.caseId as any)?.type) });
  }

  const drillSeen = new Set<string>();
  const drills: string[] = [];
  const exemplars: Exemplar[] = [];
  const perCaseType = new Map<string, number>();

  for (const r of reports as any[]) {
    const a = r.analysis || {};
    const sm = metaBySession.get(String(r.sessionId));
    if (sm && sm.module !== module) continue; // scope to the chosen category
    const caseType = sm?.caseType || 'Case';

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

  const payload: LessonPayload = {
    habitTag,
    module,
    label: meta.label,
    skill: meta.skill,
    intro: meta.intro,
    frameworks: MODULE_FRAMEWORKS[module],
    drills: drills.slice(0, DRILLS_PER_LESSON),
    exemplars: exemplars.slice(0, EXEMPLARS_PER_LESSON),
    resources: RESOURCES,
    stats: {
      reportsAnalyzed: reports.length,
      exemplarCount: Math.min(exemplars.length, EXEMPLARS_PER_LESSON),
      drillCount: Math.min(drills.length, DRILLS_PER_LESSON),
    },
  };
  lessonCache.set(cacheKey, { payload, at: Date.now() });
  return payload;
}

// The lesson library index for one category + which habit is the user's top
// bottleneck within it.
export async function getLessonIndex(userId: string, moduleArg?: string): Promise<{
  module: ModuleId;
  modules: typeof MODULES;
  frameworks: Framework[];
  lessons: Array<{ habitTag: string; label: string; skill: string; intro: string; yourCount: number }>;
  topHabit: string | null;
  resources: typeof RESOURCES;
}> {
  const module = normalizeModule(moduleArg);

  const reports = await Report.find({ userId }, { analysis: 1, sessionId: 1 }).lean();
  const sessions = await Session.find({ userId }, { interviewType: 1, config: 1 })
    .populate('caseId', 'module').lean();
  const moduleBySession = new Map<string, ModuleId>();
  for (const s of sessions as any[]) {
    moduleBySession.set(String(s._id), normalizeModule((s.caseId as any)?.module || s.interviewType || s.config?.caseType));
  }

  const counts = new Map<string, number>();
  for (const r of reports as any[]) {
    if (moduleBySession.get(String(r.sessionId)) !== module) continue;
    for (const m of (r.analysis?.missedOpportunities as any[] | undefined) ?? []) {
      const t = m?.habitTag;
      if (t && HABIT_META[t]) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  // Only this category's habits, ordered by the taxonomy.
  const tags = HABITS_BY_MODULE[module] ?? HABIT_TAGS;
  const topHabit = [...counts.entries()]
    .filter(([t]) => tags.includes(t))
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const lessons = tags.map((tag) => ({
    habitTag: tag,
    label: HABIT_META[tag].label,
    skill: HABIT_META[tag].skill,
    intro: HABIT_META[tag].intro,
    yourCount: counts.get(tag) ?? 0,
  }));
  return { module, modules: MODULES, frameworks: MODULE_FRAMEWORKS[module], lessons, topHabit, resources: RESOURCES };
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
