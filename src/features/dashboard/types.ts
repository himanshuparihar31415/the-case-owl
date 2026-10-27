/* ─────────────────────────────────────────────────────────────────────────────
   Dashboard data contract.

   These types ARE the backend contract. The UI only ever reads a
   `DashboardOverview` and calls the methods on `DashboardDataSource` (api.ts);
   it never knows whether the data is mocked or real. When the backend is built,
   it returns exactly these shapes (see README.md in this folder for endpoints).

   Raw counts and targets come from the server. Anything derivable (pace %,
   status badges, which nudge to show) is computed in logic.ts so the rules stay
   in one place and can be moved server-side later without touching the UI.
   ───────────────────────────────────────────────────────────────────────────── */

export type TypeKey = 'case' | 'guess' | 'product' | 'gd' | 'resume' | 'company';
export type Period = 'week' | 'month';

export interface Targets {
  /** Lessons per week. */
  prep: number;
  /** Interviews per `period`. */
  interviews: number;
  period: Period;
}

/** Per interview type: catalogue facts (lesson count) plus this user's progress. */
export interface TypeProgress {
  key: TypeKey;
  label: string;
  lessonsTotal: number;
  lessonsDone: number;
  interviewsDone: number;
  /** Average recent score out of 10; null = never interviewed in this type. */
  score: number | null;
}

/** A lesson the user has not completed yet. `href` is an app route the server decides. */
export interface LessonRef {
  id: string;
  title: string;
  typeKey: TypeKey;
  minutes: number;
  href: string;
}

export interface WeaknessItem {
  id: string;
  label: string;
  /** Share of recent interviews this showed up in, 0-100. */
  percent: number;
  occurrences: { count: number; total: number };
  types: string[];
  trend: { text: string; direction: 'improving' | 'worse' | 'flat' };
  lesson: { title: string; href: string };
}

export interface InterviewIssue {
  title: string;
  /** Seconds into the interview. */
  timestampSec: number;
  quote: string;
  fix: string;
}

export interface RecentInterview {
  /** Session id. */
  id: string;
  /** App route of this interview's report (resume reports live under a different path). */
  reportHref: string;
  /** ISO timestamp. */
  date: string;
  typeKey: TypeKey;
  title: string;
  score: number;
  /** Change vs the previous interview of the same type; null = first of its type. */
  deltaVsPrevious: number | null;
  durationMinutes: number;
  issues: InterviewIssue[];
}

export interface DashboardOverview {
  profile: {
    /** false → the UI shows the first-time onboarding flow instead of the dashboard. */
    onboarded: boolean;
    onboardedAt: string | null;
    /** Roles the user is preparing for (can be several). */
    roles: string[];
    companies: string[];
    timeline: string | null;
    /** ISO date placements start, if the user gave one. */
    placementDate: string | null;
  };

  targets: Targets;

  activity: {
    /** Lessons completed since Monday. */
    weekPrep: number;
    /** Interviews completed since Monday. */
    weekInterviews: number;
    /** Interviews completed this calendar month. */
    monthInterviews: number;
    totalInterviews: number;
    totalLessons: number;
  };

  readiness: {
    /** Out of 10; null until the first scored interview. */
    overall: number | null;
    /** The bar firms expect (7). */
    bar: number;
    /** Optional server label ("Building"); the client derives one if absent. */
    label?: string;
    /** Optional server sentence ("+0.6 over your last 5."). */
    deltaNote?: string;
  };

  types: TypeProgress[];

  /** Pending lessons, most useful first. The UI picks "up next" and the focus lesson from here. */
  lessonQueue: LessonRef[];

  /** Optional server-written coaching text. The client falls back to generic copy when absent. */
  coach?: {
    focusType?: TypeKey;
    /** One line under the "next step" message once the user has started practising. */
    nextStepNote?: string;
    /** Per-type sentence used in the pre-interview check. */
    gaps?: Partial<Record<TypeKey, string>>;
  };

  weaknesses: WeaknessItem[];

  recent: {
    /** Items to show on the dashboard (latest first, short sessions already excluded). */
    items: RecentInterview[];
    /** Total completed interviews, for the "All N" link. */
    total: number;
    /** Count of unfinished sessions under a minute that were hidden. */
    hiddenShort: number;
  };
}

/* ───────────── write payloads ───────────── */

export interface OnboardingAnswers {
  /** One or more target roles. */
  roles: string[];
  companies: string[];
  timeline: string;
  /** 1 = never tried, 5 = confident, per interview type. */
  comfort: Record<TypeKey, number>;
}

/** What every data source (mock or HTTP) must implement. */
export interface DashboardDataSource {
  getOverview(): Promise<DashboardOverview>;
  /** Persists the answers, marks the user onboarded, returns the targets that were set. */
  completeOnboarding(answers: OnboardingAnswers): Promise<{ targets: Targets }>;
  saveTargets(targets: Targets): Promise<Targets>;
}
