// ── Canonical habit taxonomy ─────────────────────────────────────────────────
// Single source of truth for the recurring "habits" the evaluator tags on
// missedOpportunities, shared by the evaluation prompt, analytics, and the
// coaching/lessons layer. Habits are category-specific: consulting, product,
// and guesstimate each surface a different set (some tags are shared where the
// behaviour is genuinely the same).

export type HabitModule = 'case' | 'product' | 'guesstimate';

export interface HabitMeta {
  label: string;
  skill: string;
  intro: string;
  // Which idealAnswers[].skillTested count as a model example for this habit.
  skillMatch: RegExp;
  // Which timeManagement[].stage measures this habit (used for loop closure).
  stageMatch: RegExp;
}

export const HABIT_META: Record<string, HabitMeta> = {
  // ── Consulting ──
  rush_structuring: {
    label: 'Rushed structuring phase',
    skill: 'Structuring',
    intro: 'Strong candidates spend real time up front building a clean, MECE structure before diving in. These are model structuring moments pulled from real cases — notice the framework stated up front and why each one holds together.',
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
  shallow_risk: {
    label: 'Shallow risk analysis',
    skill: 'Risk analysis',
    intro: 'A recommendation with no risks reads as naive. See how model answers surface the real downside risks and how they would mitigate them.',
    skillMatch: /risk|downside|mitigat|tradeoff/i,
    stageMatch: /synth|recommend|risk/i,
  },

  // ── Shared across categories ──
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
  weak_synthesis: {
    label: 'Weak synthesis / close',
    skill: 'Synthesis',
    intro: 'A strong close ties findings into a crisp recommendation with quantified impact, the key risk, and next steps. Study how these model recommendations land.',
    skillMatch: /synth|recommend|conclu|close|so.?what/i,
    stageMatch: /synth|recommend|conclu|close/i,
  },
  clarity: {
    label: 'Communication breaks down',
    skill: 'Structured communication',
    intro: 'Interviewers reward top-down, signposted answers: the headline first, then the supporting logic. These model answers show that shape in action.',
    skillMatch: /communicat|clar|top.?down|signpost|concise|structure/i,
    stageMatch: /./,
  },

  // ── Product ──
  vague_problem: {
    label: 'Jumped to solutions',
    skill: 'Problem framing',
    intro: 'Strong PM candidates clarify the scope and the real goal before proposing anything. These model moments show the framing questions that must come first.',
    skillMatch: /problem|scope|clarif|goal|frame|objective|context/i,
    stageMatch: /clarif|understand|frame|scope|goal/i,
  },
  no_user_focus: {
    label: 'Ignored the user',
    skill: 'User empathy',
    intro: 'Great product answers are grounded in specific user segments and their real pain — not generic "users". See how model answers name the segment and the job to be done.',
    skillMatch: /user|segment|persona|need|pain|empath|jtbd|customer/i,
    stageMatch: /user|segment|persona/i,
  },
  no_prioritization: {
    label: 'No clear prioritization',
    skill: 'Prioritization',
    intro: 'Ideas are cheap; prioritization is the skill. These model answers make the tradeoffs explicit and defensible with a clear ranking rationale.',
    skillMatch: /priorit|tradeoff|rice|rank|impact.*effort/i,
    stageMatch: /priorit|tradeoff/i,
  },
  no_metrics: {
    label: 'No success metrics',
    skill: 'Metrics sense',
    intro: 'A product decision without a success metric is a guess. See how model answers define what to measure and the one metric that moves the goal.',
    skillMatch: /metric|measure|kpi|success|north.?star|aarrr|funnel/i,
    stageMatch: /metric|goal|measure/i,
  },
  shallow_ideation: {
    label: 'Shallow ideation',
    skill: 'Product sense',
    intro: 'Strong candidates generate a range of ideas — obvious to bold — before converging. See how model answers explore the solution space with real product sense.',
    skillMatch: /idea|solution|creativ|brainstorm|product sense|feature/i,
    stageMatch: /solution|ideat/i,
  },

  // ── Guesstimate ──
  no_decomposition: {
    label: 'Skipped decomposition',
    skill: 'Decomposition',
    intro: 'A clean estimate starts with a clean decomposition before any numbers. These model moments show the tree laid out first, top-down or bottom-up.',
    skillMatch: /decompos|structur|break.?down|segment|approach|tree/i,
    stageMatch: /structur|decompos|approach/i,
  },
  unit_error: {
    label: 'Unit / math slips',
    skill: 'Clean arithmetic',
    intro: 'Estimates live or die on clean units and careful arithmetic. See how model answers keep units explicit and the math easy to follow.',
    skillMatch: /unit|arithmetic|math|calcul|conversion|magnitude/i,
    stageMatch: /calcul|quant|math/i,
  },
  no_segmentation: {
    label: 'No segmentation',
    skill: 'Segmentation',
    intro: 'Averaging across a whole population hides the answer. See how model answers split into groups that behave differently, size each, then sum.',
    skillMatch: /segment|split|group|cohort|breakdown/i,
    stageMatch: /segment|structur/i,
  },
};

// Which habits each broader category surfaces (ordered by how commonly they matter).
export const HABITS_BY_MODULE: Record<HabitModule, string[]> = {
  case: ['rush_structuring', 'no_hypothesis', 'invent_number', 'skip_validation', 'weak_synthesis', 'shallow_risk', 'clarity'],
  product: ['vague_problem', 'no_user_focus', 'no_prioritization', 'no_metrics', 'shallow_ideation', 'weak_synthesis', 'clarity'],
  guesstimate: ['no_decomposition', 'invent_number', 'unit_error', 'no_segmentation', 'skip_validation', 'clarity'],
};

export const HABIT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(HABIT_META).map(([k, v]) => [k, v.label])
);

export const normalizeHabitModule = (x?: string): HabitModule => {
  const s = String(x || '').toLowerCase();
  if (/product|\bpm\b/.test(s)) return 'product';
  if (/guess|estimat|sizing/.test(s)) return 'guesstimate';
  return 'case';
};
