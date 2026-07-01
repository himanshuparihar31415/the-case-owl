// Three-pillar composite scoring (The Case Owl scoring framework).
//   Case navigation 40%  — the case map is its OWN engine; we don't re-rubric it.
//     We translate its two outputs into a 0-10: the grade matrix sets the BAND,
//     Global% positions you WITHIN the band.
//   Structure & presentation 30% — LLM scorecard sub-metrics (1-10, rubric).
//   Communication 30% — LLM scorecard sub-metrics (1-10, rubric).
// composite = nav×0.40 + structure×0.30 + communication×0.30.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SubScore { key: string; label: string; score: number; weight: number; note?: string }
export interface NavDetail { grade: string; globalPct: number; floor: number; ceil: number; terminalsReached?: number; terminalsTotal?: number; strongBranches?: number }
export interface Pillar { key: string; label: string; raw: number; weightPct: number; percentile: number; subs: SubScore[]; navDetail?: NavDetail }
export interface PillarScore {
  pillars: Pillar[];
  composite: number;   // 1-10
  percentile: number;  // 0-100 (estimate until per-case-type population data exists)
  verdict: string;     // Strong Hire | Hire | Lean Hire | Lean No Hire | No Hire
  band: string;        // Exceptional | Strong | Borderline | Below bar | Needs work
}

// ── Structure & Communication sub-metric weights (sheet "Sub-metric weights") ──
const STRUCT_W: Record<string, [string, number]> = {
  framework: ['Framework stated', 0.20],
  mece: ['MECE quality', 0.15],
  topDown: ['Top-down delivery', 0.15],
  signposting: ['Signposting', 0.10],
  timeAllocation: ['Time allocation', 0.10],
  synthesis: ['Synthesis quality', 0.15],
  prioritization: ['Prioritization', 0.10],
  askQuality: ['Ask quality', 0.05],
};
const COMM_W: Record<string, [string, number]> = {
  filler: ['Filler word rate', 0.10],
  conciseness: ['Conciseness', 0.15],
  vocabulary: ['Vocabulary precision', 0.10],
  coherence: ['Coherence', 0.20],
  pause: ['Pause management', 0.10],
  recovery: ['Recovery under pressure', 0.15],
  confidence: ['Confidence & presence', 0.10],
  listening: ['Listening accuracy', 0.10],
};

const clamp = (n: number): number => Math.max(1, Math.min(10, n));

// ── Case navigation: grade sets the 0-10 band, Global% positions within it ──
// (The case map keeps its own point totals, bonuses, and grade matrix — untouched.)
const NAV_BANDS: Record<string, [number, number]> = {
  'No Hire': [0, 2],
  'Lean No': [2, 4],
  'Lean No Hire': [2, 4],
  Borderline: [4, 6],
  Hire: [6, 8],
  'Strong Hire': [8, 10],
};
function navFromCaseMap(treeScore: any): { raw: number; detail: NavDetail } {
  const grade = String(treeScore?.grade ?? 'Borderline');
  const [floor, ceil] = NAV_BANDS[grade] ?? [4, 6];
  const globalPct = Number(treeScore?.global?.percentage ?? treeScore?.percentage ?? 0);
  const raw = Math.round((floor + (globalPct / 100) * (ceil - floor)) * 100) / 100;
  return {
    raw,
    detail: {
      grade, globalPct, floor, ceil,
      terminalsReached: treeScore?.terminals_reached,
      terminalsTotal: treeScore?.terminals_total,
      strongBranches: treeScore?.strong_branches,
    },
  };
}

// Structure / Communication sub-metrics come straight from the LLM scorecard.
function llmSubs(weights: Record<string, [string, number]>, card: any): SubScore[] {
  return Object.entries(weights).map(([k, [label, w]]) => {
    const entry = card?.[k];
    const score = clamp(Number(entry?.score ?? 5));
    return { key: k, label, weight: w, score: Math.round(score * 10) / 10, note: entry?.note ? String(entry.note) : undefined };
  });
}
const pillarRaw = (subs: SubScore[]): number => Math.round(subs.reduce((s, x) => s + x.score * x.weight, 0) * 100) / 100;

// composite raw (1-10) → percentile band (sheet "raw score range"; an estimate
// until we compute true percentiles from accumulated per-case-type sessions).
function pctFromRaw(r: number): number {
  if (r >= 8.5) return 97;
  if (r >= 7.5) return 92;
  if (r >= 6.5) return 82;
  if (r >= 5.0) return 62;
  if (r >= 3.5) return 40;
  return 15;
}
function verdictFor(pct: number): { verdict: string; band: string } {
  if (pct >= 95) return { verdict: 'Strong Hire', band: 'Exceptional' };
  if (pct >= 75) return { verdict: 'Hire', band: 'Strong' };
  if (pct >= 50) return { verdict: 'Lean Hire', band: 'Borderline' };
  if (pct >= 25) return { verdict: 'Lean No Hire', band: 'Below bar' };
  return { verdict: 'No Hire', band: 'Needs work' };
}

export function computePillarScore(opts: { treeScore: any; scorecard: any }): PillarScore {
  const nav = navFromCaseMap(opts.treeScore);
  const structure = llmSubs(STRUCT_W, opts.scorecard?.structure);
  const communication = llmSubs(COMM_W, opts.scorecard?.communication);

  const structRaw = pillarRaw(structure);
  const commRaw = pillarRaw(communication);

  const pillars: Pillar[] = [
    { key: 'navigation', label: 'Case navigation', raw: nav.raw, weightPct: 40, percentile: pctFromRaw(nav.raw), subs: [], navDetail: nav.detail },
    { key: 'structure', label: 'Structure & presentation', raw: structRaw, weightPct: 30, percentile: pctFromRaw(structRaw), subs: structure },
    { key: 'communication', label: 'Communication', raw: commRaw, weightPct: 30, percentile: pctFromRaw(commRaw), subs: communication },
  ];

  const composite = Math.round((nav.raw * 0.40 + structRaw * 0.30 + commRaw * 0.30) * 100) / 100;
  const percentile = pctFromRaw(composite);
  const { verdict, band } = verdictFor(percentile);
  return { pillars, composite, percentile, verdict, band };
}
