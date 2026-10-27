import { TIMELINE_TARGETS } from './config';
import type { DashboardOverview, LessonRef, Targets, TypeKey, TypeProgress } from './types';

/* Pure functions only: no fetching, no React. Everything the dashboard decides
   (pace, status, which nudge) lives here so the rules can later
   move server-side without touching a component. */

/* ───────────── dates ───────────── */

export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Share of the week elapsed today, counting today (Mon = 1/7 … Sun = 7/7). */
export function weekFraction(now: Date): number {
  return (((now.getDay() + 6) % 7) + 1) / 7;
}

export function monthFraction(now: Date): number {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() / days;
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ───────────── readiness ───────────── */

export function readinessLabel(overall: number | null, label?: string): string {
  if (label) return label;
  if (overall == null) return 'No score yet';
  if (overall < 5) return 'Not ready';
  if (overall < 7) return 'Building';
  return 'Ready';
}

/* ───────────── pace ───────────── */

/** Where "today" sits on the week/month, shown as a marker on each tracker. No good/bad judgement is made. */
export interface Tracker {
  kind: 'prep' | 'interviews';
  eyebrow: string;
  unit: string;
  done: number;
  target: number;
  /** True while the user has no activity at all yet (shown as a neutral "Just started"). */
  fresh: boolean;
  /** 0-100, bar fill. */
  fill: number;
  /** 0-100, where "expected by today" sits on the bar. */
  marker: number;
  expectedText: string;
  note: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function makeTracker(
  kind: Tracker['kind'], eyebrow: string, unit: string, done: number, target: number,
  frac: number, by: string, fresh: boolean,
): Tracker {
  const expected = target * frac;
  const pct = expected ? Math.round((done / expected) * 100) : 100;
  const remaining = Math.max(0, target - done);
  return {
    kind, eyebrow, unit, done, target, fresh,
    fill: target ? Math.min(100, (done / target) * 100) : 0,
    marker: fresh ? 0 : frac * 100,
    expectedText: fresh ? 'Your plan starts now' : `Expected by today: ${round1(expected)} · ${pct}% of pace`,
    note: remaining ? `${remaining} to go by ${by}` : 'Target met',
  };
}

export const hasNoActivity = (o: DashboardOverview) => o.activity.totalInterviews === 0 && o.activity.totalLessons === 0;

export function buildTrackers(o: DashboardOverview, now: Date) {
  const fresh = hasNoActivity(o);
  const wf = weekFraction(now);
  const t = o.targets;

  const prep = makeTracker('prep', 'PREP THIS WEEK', 'lessons', o.activity.weekPrep, t.prep, wf, 'Sunday', fresh);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const interviews = t.period === 'month'
    ? makeTracker('interviews', 'INTERVIEWS THIS MONTH', 'interviews', o.activity.monthInterviews, t.interviews, monthFraction(now), formatShortDate(isoDate(monthEnd)), fresh)
    : makeTracker('interviews', 'INTERVIEWS THIS WEEK', 'interviews', o.activity.weekInterviews, t.interviews, wf, 'Sunday', fresh);

  return { prep, interviews, fresh };
}

/* ───────────── focus + lessons ───────────── */

export function focusType(o: DashboardOverview): TypeProgress {
  const byKey = (k?: TypeKey) => (k ? o.types.find((x) => x.key === k) : undefined);
  const scored = o.types.filter((x) => x.score != null).sort((a, b) => (a.score as number) - (b.score as number));
  // Weakest scored type; with no scores yet, the type with the least prep done.
  const leastPrepped = [...o.types].sort((a, b) => a.lessonsDone / (a.lessonsTotal || 1) - b.lessonsDone / (b.lessonsTotal || 1))[0];
  return byKey(o.coach?.focusType) ?? scored[0] ?? leastPrepped;
}

export function lessonFor(o: DashboardOverview, key: TypeKey): LessonRef | null {
  return o.lessonQueue.find((l) => l.typeKey === key) ?? o.lessonQueue[0] ?? null;
}

export function pendingLessons(o: DashboardOverview, key: TypeKey): LessonRef[] {
  return o.lessonQueue.filter((l) => l.typeKey === key);
}

/** The "Up next" list: the focus type first, then others, max 3, at most 2 per type. */
export function upNext(o: DashboardOverview, focus: TypeKey): LessonRef[] {
  const order = [focus, ...o.types.map((t) => t.key).filter((k) => k !== focus)];
  const out: LessonRef[] = [];
  for (const k of order) {
    for (const l of pendingLessons(o, k).slice(0, 2)) if (out.length < 3) out.push(l);
  }
  return out;
}

export const lessonsDone = (o: DashboardOverview) => o.types.reduce((a, t) => a + t.lessonsDone, 0);
export const lessonsTotal = (o: DashboardOverview) => o.types.reduce((a, t) => a + t.lessonsTotal, 0);

/* ───────────── type table ───────────── */

export type TypeStatus = { label: string; badge: string };

export function typeStatus(t: TypeProgress, bar: number): TypeStatus {
  const prepShare = t.lessonsTotal ? t.lessonsDone / t.lessonsTotal : 0;
  if (t.interviewsDone === 0) return { label: 'Untested', badge: 'text-slate-600 bg-slate-100' };
  if (prepShare < 0.4 && t.interviewsDone >= 5) return { label: 'Prep gap', badge: 'text-amber-700 bg-amber-100' };
  if ((t.score ?? 0) >= bar) return { label: 'Ready', badge: 'text-green-700 bg-green-100' };
  return { label: 'Building', badge: 'text-sky-700 bg-sky-100' };
}

/* ───────────── onboarding ───────────── */

/** Placeholder for the server rule: shorter runway → higher weekly targets. */
export function suggestTargets(timeline: string): Targets {
  const [prep, interviews] = TIMELINE_TARGETS[timeline] ?? [4, 3];
  return { prep, interviews, period: 'week' };
}

/** The type the user feels least comfortable with: prep starts there. */
export function leastComfortable(types: TypeProgress[], comfort: Record<TypeKey, number>): TypeProgress {
  return [...types].sort((a, b) => (comfort[a.key] ?? 3) - (comfort[b.key] ?? 3))[0];
}

/* ───────────── the coach nudge ───────────── */

export type NudgeAction =
  | { label: string; do: 'lesson'; lesson: LessonRef }
  | { label: string; do: 'check'; type: TypeKey }
  | { label: string; do: 'baseline' };

export interface Nudge {
  /** Tailwind background colour class for the little status dot. */
  dot: string;
  eyebrow: string;
  title: string;
  body: string;
  primary: NudgeAction;
  secondary?: NudgeAction;
}

/** Lesson CTA, or an interview CTA when the user has finished every lesson. */
function prepAction(lesson: LessonRef | null, type: TypeProgress): NudgeAction {
  return lesson
    ? { do: 'lesson', lesson, label: `Start lesson: ${lesson.title} · ${lesson.minutes} min` }
    : { do: 'check', type: type.key, label: `Start ${type.label.toLowerCase()} interview` };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function pickNudge(o: DashboardOverview): Nudge {
  const F = focusType(o);
  const prepCta = prepAction(lessonFor(o, F.key), F);
  const t = o.targets;
  const per = t.period === 'week' ? 'a week' : 'a month';

  // Brand new: point at the first lesson, with a baseline as the alternative.
  if (hasNoActivity(o)) {
    return {
      dot: 'bg-sky-300',
      eyebrow: 'YOUR PLAN IS SET',
      title: 'Start with one lesson, then a baseline interview.',
      body: `Your targets are ${plural(t.prep, 'lesson')} a week and ${plural(t.interviews, 'interview')} ${per}. Prep first on ${F.label.toLowerCase()}, then a short baseline gives you a real score to improve on.`,
      primary: prepCta,
      secondary: { do: 'baseline', label: 'Take a baseline interview' },
    };
  }

  // Everyone else: one neutral next step on the weakest type.
  return {
    dot: 'bg-sky-300',
    eyebrow: 'NEXT STEP',
    title: `Keep building your ${F.label.toLowerCase()} skills.`,
    body: o.coach?.nextStepNote ?? `${F.label} is your weakest type right now. A lesson, then an interview, is the fastest way to move it.`,
    primary: prepCta,
  };
}
