// Three-pillar composite scoring (The Case Owl scoring framework).
//   Case navigation 40%  — computed DETERMINISTICALLY from the case map.
//   Structure & presentation 30% — scored 1-10 by the LLM (rubric anchors).
//   Communication 30% — scored 1-10 by the LLM (rubric anchors).
// pillar raw = Σ(sub-metric 1-10 × weight-in-pillar); composite = weighted pillars;
// composite raw → percentile band → verdict.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SubScore { key: string; label: string; score: number; weight: number; note?: string }
export interface Pillar { key: string; label: string; raw: number; weightPct: number; percentile: number; subs: SubScore[] }
export interface PillarScore {
  pillars: Pillar[];
  composite: number;   // 1-10
  percentile: number;  // 0-100
  verdict: string;     // Strong Hire | Hire | Lean Hire | Lean No Hire | No Hire
  band: string;        // Exceptional | Strong | Borderline | Below bar | Needs work
}

// ── weights within each pillar (sheet: "Sub-metric weights") ──
const NAV_W: Record<string, [string, number]> = {
  coverageBreadth: ['Coverage breadth', 0.15],
  coverageDepth: ['Coverage depth', 0.15],
  terminals: ['Terminal nodes reached', 0.10],
  criticalPath: ['Critical path hit rate', 0.25],
  wrongTurns: ['Wrong turns', 0.05],
  trapAvoidance: ['Trap avoidance', 0.05],
  independence: ['Independence', 0.10],
  exhibitUtil: ['Exhibit utilization', 0.05],
  quant: ['Quantitative accuracy', 0.10],
};
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
// midpoint of each 1-10 rubric band → a clean deterministic score
const band5 = (b: 0 | 1 | 2 | 3 | 4): number => [1.5, 3.5, 5.5, 7.5, 9.5][b];

// ── Navigation sub-metric raw scores (from the case map) ──
function navSubs(treeScore: any, treeSummary: any, evalTree: any, quantRaw: number): SubScore[] {
  const g = treeScore?.global ?? {};
  const explored = Number(treeSummary?.nodes_explored ?? 0);
  const total = Number(treeSummary?.total_nodes_in_reference ?? 0) || 1;
  const breadthPct = (explored / total) * 100;
  const depth = Number(treeSummary?.max_depth_on_correct_path ?? 0) || maxDepth(treeScore);
  const terminals = Number(treeScore?.terminals_reached ?? 0);
  const wrong = Number(treeSummary?.wrong_turns_taken ?? 0);
  const nudges = Number(treeSummary?.nudges_given ?? 0);
  const exhibits = Number(treeSummary?.exhibits_requested_unprompted ?? 0);
  const { found, totalCrit } = countCritical(evalTree);
  void g;

  const breadth = breadthPct >= 75 ? band5(4) : breadthPct >= 50 ? band5(3) : breadthPct >= 25 ? band5(2) : breadthPct >= 10 ? band5(1) : band5(0);
  const depthS = depth >= 5 ? band5(4) : depth >= 4 ? band5(3) : depth >= 3 ? band5(2) : depth >= 2 ? band5(1) : band5(0);
  const termS = terminals >= 7 ? band5(4) : terminals >= 4 ? band5(3) : terminals >= 2 ? band5(2) : terminals >= 1 ? band5(1) : band5(0);
  const critS = totalCrit === 0 ? band5(2) // no critical nodes flagged → neutral
    : found >= totalCrit ? band5(4) : found >= totalCrit - 1 ? band5(3) : found >= totalCrit / 2 ? band5(2) : found >= 1 ? band5(1) : band5(0);
  const wrongS = wrong === 0 ? (depth >= 4 ? band5(4) : band5(3)) : wrong === 1 ? band5(2) : wrong === 2 ? band5(1) : band5(0);
  const trapS = wrong === 0 ? band5(3) : wrong === 1 ? band5(2) : wrong <= 2 ? band5(1) : band5(0);
  const indS = nudges === 0 ? band5(3) : nudges === 1 ? band5(2) : nudges <= 3 ? band5(1) : band5(0);
  const exS = exhibits >= 3 ? band5(4) : exhibits === 2 ? band5(3) : exhibits === 1 ? band5(2) : band5(1);
  const quantS = clamp(quantRaw || 5);

  const raw: Record<string, number> = { coverageBreadth: breadth, coverageDepth: depthS, terminals: termS, criticalPath: critS, wrongTurns: wrongS, trapAvoidance: trapS, independence: indS, exhibitUtil: exS, quant: quantS };
  return Object.entries(NAV_W).map(([k, [label, w]]) => ({ key: k, label, weight: w, score: Math.round(raw[k] * 10) / 10 }));
}

function maxDepth(treeScore: any): number {
  const local = treeScore?.local ?? {};
  return Object.values(local).reduce((m: number, b: any) => Math.max(m, Number(b?.depth_reached ?? 0)), 0) as number;
}
function countCritical(node: any, acc = { found: 0, totalCrit: 0 }): { found: number; totalCrit: number } {
  if (!node || typeof node !== 'object') return acc;
  if (node.critical === true) {
    acc.totalCrit += 1;
    const cs = String(node.candidate_status ?? 'skipped');
    if (cs === 'explored' || cs === 'mentioned') acc.found += 1;
  }
  for (const c of (Array.isArray(node.children) ? node.children : [])) countCritical(c, acc);
  return acc;
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

// composite raw (1-10) → percentile band (sheet "Pillar raw score range")
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

export function computePillarScore(opts: {
  treeScore: any; treeSummary: any; evalTree: any;
  quantRaw: number; scorecard: any;
}): PillarScore {
  const nav = navSubs(opts.treeScore, opts.treeSummary, opts.evalTree, opts.quantRaw);
  const structure = llmSubs(STRUCT_W, opts.scorecard?.structure);
  const communication = llmSubs(COMM_W, opts.scorecard?.communication);

  const navRaw = pillarRaw(nav);
  const structRaw = pillarRaw(structure);
  const commRaw = pillarRaw(communication);

  const pillars: Pillar[] = [
    { key: 'navigation', label: 'Case navigation', raw: navRaw, weightPct: 40, percentile: pctFromRaw(navRaw), subs: nav },
    { key: 'structure', label: 'Structure & presentation', raw: structRaw, weightPct: 30, percentile: pctFromRaw(structRaw), subs: structure },
    { key: 'communication', label: 'Communication', raw: commRaw, weightPct: 30, percentile: pctFromRaw(commRaw), subs: communication },
  ];

  const composite = Math.round((navRaw * 0.40 + structRaw * 0.30 + commRaw * 0.30) * 100) / 100;
  const percentile = pctFromRaw(composite);
  const { verdict, band } = verdictFor(percentile);
  return { pillars, composite, percentile, verdict, band };
}
