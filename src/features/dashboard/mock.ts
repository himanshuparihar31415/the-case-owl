import { isoDate, suggestTargets } from './logic';
import type {
  DashboardDataSource, DashboardOverview, LessonRef, OnboardingAnswers, Targets, TypeKey, TypeProgress,
} from './types';

/* ─────────────────────────────────────────────────────────────────────────────
   MOCK data source: front-end development only.

   Stands in for the backend until it exists. Onboarding answers and edited
   targets persist in localStorage so the real flow works end to end
   (new user → onboarding → dashboard).

   Scenarios (switch with the dev bar, or ?scenario=… in the URL):
     new      first login, not onboarded       → onboarding flow
     started  just onboarded, no activity yet  → dashboard, empty state
   ───────────────────────────────────────────────────────────────────────────── */

export type ScenarioKey = 'new' | 'started';
export const MOCK_SCENARIOS: Array<{ key: ScenarioKey; label: string }> = [
  { key: 'new', label: 'New user' },
  { key: 'started', label: 'Just onboarded' },
];

/* ───────────── persistence ───────────── */

const KEY = 'dashboard_mock_v1';
interface MockState {
  scenario?: ScenarioKey;
  onboarded?: { answers: OnboardingAnswers; at: string };
  targets?: Targets;
}
const load = (): MockState => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as MockState; } catch { return {}; }
};
const save = (s: MockState) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: state just won't persist */ }
};

export function getMockScenario(): ScenarioKey {
  const s = load();
  // A scenario saved by an earlier version of the mock (the removed journeys) is ignored.
  if (s.scenario && MOCK_SCENARIOS.some((x) => x.key === s.scenario)) return s.scenario;
  return s.onboarded ? 'started' : 'new';
}

export function setMockScenario(scenario: ScenarioKey) {
  const s = load();
  s.scenario = scenario;
  // Switching back to "new" must really make the user new again.
  if (scenario === 'new') { delete s.onboarded; delete s.targets; }
  save(s);
}

export function resetMock() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/* ───────────── fixture helpers ───────────── */

const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

const CATALOG: Array<{ key: TypeKey; label: string }> = [
  { key: 'case', label: 'Case' },
  { key: 'guess', label: 'Guesstimate' },
  { key: 'product', label: 'Product' },
  { key: 'gd', label: 'Group discussion' },
  { key: 'resume', label: 'Resume' },
  { key: 'company', label: 'Company-specific' },
];

const LESSONS: Record<TypeKey, string[]> = {
  case: ['Profitability deep dive', 'Market entry', 'Structuring a case from scratch', 'Hypothesis-first thinking', 'M&A cases', 'Pricing cases', 'Operations cases', 'Synthesis and recommendation', 'Reading charts and exhibits', 'Case math under pressure'],
  guess: ['Top-down vs bottom-up', 'Sanity-checking your numbers', 'Population and demand trees', 'Supply-side estimates', 'Revenue guesstimates', 'Presenting your estimate'],
  product: ['Product sense basics', 'Root-causing a metric drop', 'Metrics and north stars', 'Designing for one user segment', 'Prioritising with RICE', 'Go-to-market', 'Estimation in product rounds', 'Trade-off questions'],
  gd: ['Opening a GD', 'Adding without repeating', 'Handling dominant speakers', 'Summarising the room'],
  resume: ['Your story in 90 seconds', 'STAR answers with numbers', 'Defending gaps and pivots', 'Why this role, why this firm', 'Questions to ask the panel'],
  company: ['McKinsey PEI', 'McKinsey case style', 'BCG case style', 'Bain case style', 'Amazon leadership principles', 'Amazon bar-raiser round', 'Goldman superday', 'FMCG rounds: HUL, ITC', 'Google product rounds'],
};

const LEARN_HREF: Record<TypeKey, string> = {
  case: '/learn?m=case', guess: '/learn?m=guesstimate', product: '/learn?m=product', gd: '/learn', resume: '/learn', company: '/learn',
};

const lessonMinutes = (key: TypeKey, idx: number) => 10 + ((idx * 3 + key.length) % 9);

/** Every lesson is pending for a user who has done none. */
function buildQueue(): LessonRef[] {
  return CATALOG.flatMap(({ key }) =>
    LESSONS[key].map((title, idx): LessonRef => ({
      id: `${key}-${idx}`, title, typeKey: key, minutes: lessonMinutes(key, idx), href: LEARN_HREF[key],
    })));
}

function buildOverview(scenario: ScenarioKey): DashboardOverview {
  const st = load();
  const answers = st.onboarded?.answers;
  const onboarded = scenario !== 'new';

  const types: TypeProgress[] = CATALOG.map((c) => ({
    ...c, lessonsTotal: LESSONS[c.key].length, lessonsDone: 0, interviewsDone: 0, score: null,
  }));

  return {
    profile: {
      onboarded,
      onboardedAt: st.onboarded?.at ?? (onboarded ? new Date().toISOString() : null),
      roles: answers?.roles ?? [],
      companies: answers?.companies ?? [],
      timeline: answers?.timeline ?? null,
      placementDate: onboarded ? isoDate(daysFromNow(37)) : null,
    },
    targets: st.targets ?? (answers ? suggestTargets(answers.timeline) : { prep: 4, interviews: 3, period: 'week' }),
    activity: { weekPrep: 0, weekInterviews: 0, monthInterviews: 0, totalInterviews: 0, totalLessons: 0 },
    readiness: { overall: null, bar: 7 },
    types,
    lessonQueue: buildQueue(),
    weaknesses: [],
    recent: { items: [], total: 0, hiddenShort: 0 },
  };
}

/* ───────────── the data source ───────────── */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `?scenario=started` in the URL switches the mock scenario (dev convenience). */
function applyUrlScenario() {
  const q = new URLSearchParams(window.location.search).get('scenario') as ScenarioKey | null;
  if (q && MOCK_SCENARIOS.some((s) => s.key === q)) setMockScenario(q);
}

export const mockSource: DashboardDataSource = {
  async getOverview() {
    await delay(250);
    applyUrlScenario();
    return buildOverview(getMockScenario());
  },

  async completeOnboarding(answers) {
    await delay(300);
    const s = load();
    const targets = suggestTargets(answers.timeline);
    s.onboarded = { answers, at: new Date().toISOString() };
    s.targets = targets;
    delete s.scenario; // fall through to "started" (onboarded, no activity yet)
    save(s);
    return { targets };
  },

  async saveTargets(targets) {
    await delay(200);
    const s = load();
    s.targets = targets;
    save(s);
    return targets;
  },
};
