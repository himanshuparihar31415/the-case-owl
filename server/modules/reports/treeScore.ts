// Deterministic tree-traversal scoring engine (no LLM, pure math). Walks the
// candidate's ordered node-visit list against the reference tree and produces a
// DUAL score — a GLOBAL score (breadth + prioritisation + structure across the
// whole case) and a LOCAL per-branch score (how good the thinking was on each
// branch they chose) — plus a two-dimensional grade. Implements the revised
// "depth-rewarded, breadth-aware" scoring strategy.

type RawNode = {
  id?: string; label?: string; depth?: number;
  status?: string; reference_status?: string; rank?: number;
  children?: RawNode[];
};
type Visit = { id?: string; was_nudged?: boolean };

interface IndexedNode { id: string; label: string; status: string; depth: number; rank?: number; hasCorrectChild: boolean }

// --- weight tables ---
const CORRECT_W: Record<number, number> = { 0: 0, 1: 5, 2: 10, 3: 20, 4: 35, 5: 55, 6: 75, 7: 95, 8: 120 };
const correctWeight = (d: number): number => CORRECT_W[d] ?? (d > 8 ? 120 : 0);
// Soft nudge: a hint is a flag, not a punishment. Nudged node ×0.85, next ×0.95.
const nudgeMultFor = (countdown: number): number => (countdown === 2 ? 0.85 : countdown === 1 ? 0.95 : 1.0);
// Contamination decay after wrong turns / dead ends on a branch. Kept GENTLE —
// a wrong turn shouldn't crater the branch, just lightly dampen what follows.
const decay = (c: number): number => (c <= 0 ? 1.0 : c === 1 ? 0.9 : c === 2 ? 0.8 : c === 3 ? 0.7 : 0.6);
// Chain reward for sustained parent→child correct depth, capped at 1.3.
const chainMult = (len: number): number => (len >= 7 ? 1.3 : len === 6 ? 1.25 : len === 5 ? 1.2 : len === 4 ? 1.15 : len === 3 ? 1.1 : 1.0);
// Dead ends earn nothing and no longer subtract points — reaching one already
// forfeits the correct-path points; a small -1 keeps a faint signal only.
const DEAD_END_PENALTY = -1;
// Answer-key trees are built 7-8 deep, but a candidate realistically drives a
// branch to ~depth 5 in a 35-40 min case. Scoring against the full depth crushes
// every branch (depth 5 of 8 ≈ 42% because the deepest nodes carry the most
// points). So we measure against a REACHABLE frontier: a branch's "conclusion" is
// its deepest correct node OR REACH_DEPTH, whichever is shallower, and both the
// per-branch max and the global max are computed against that capped ideal.
const REACH_DEPTH = 5;

const statusOf = (n: RawNode): string => n.reference_status ?? n.status ?? 'neutral';
const branchOf = (id: string): string => (id === 'root' ? 'root' : id.split('.')[0]);
const parentOf = (id: string): string => { const p = id.split('.'); return p.length <= 1 ? 'root' : p.slice(0, -1).join('.'); };

function indexTree(root: RawNode): Map<string, IndexedNode> {
  const map = new Map<string, IndexedNode>();
  const walkIdx = (n: RawNode) => {
    const children = n.children ?? [];
    const hasCorrectChild = children.some((c) => statusOf(c) === 'correct');
    map.set(String(n.id), { id: String(n.id), label: n.label ?? '', status: statusOf(n), depth: n.depth ?? 0, rank: n.rank, hasCorrectChild });
    children.forEach(walkIdx);
  };
  walkIdx(root);
  return map;
}

// ---- public output shapes ----
export interface LocalBranch {
  label: string;
  not_explored?: boolean;
  points?: number; max?: number; percentage?: number; grade?: string;
  depth_reached?: number; terminal_reached?: boolean; contamination?: number; nudges?: number;
}
export interface TreeScore {
  global: { score: number; max: number; percentage: number };
  local: Record<string, LocalBranch>;
  terminals_reached: number;
  terminals_total: number;
  strong_branches: number;
  grade: string;
  idealPath: string[];        // ordered node ids of the max-points traversal
  perNodePoints: Record<string, number>;
}

function branchGrade(pct: number): string {
  if (pct >= 85) return 'Excellent';
  if (pct >= 70) return 'Good';
  if (pct >= 50) return 'Adequate';
  if (pct >= 30) return 'Weak';
  return 'Poor';
}

// ---- two-dimensional grade matrix ----
const GRADES = ['No Hire', 'Lean No', 'Borderline', 'Hire', 'Strong Hire'];
function gradeMatrix(strongBranches: number, terminals: number): string {
  const row = Math.min(3, strongBranches);       // 0,1,2,3+
  const col = Math.min(4, terminals);             // 0..4+
  const M = [
    ['No Hire', 'Lean No', 'Lean No', 'Borderline', 'Borderline'],
    ['Lean No', 'Borderline', 'Borderline', 'Hire', 'Hire'],
    ['Borderline', 'Borderline', 'Hire', 'Hire', 'Strong Hire'],
    ['Borderline', 'Hire', 'Hire', 'Strong Hire', 'Strong Hire'],
  ];
  return M[row][col];
}
const bumpUp = (g: string): string => GRADES[Math.min(GRADES.length - 1, GRADES.indexOf(g) + 1)];
const capAt = (g: string, cap: string): string => GRADES[Math.min(GRADES.indexOf(g), GRADES.indexOf(cap))];

interface WalkResult {
  pathPoints: number;
  branchPoints: Map<string, number>;
  branchContam: Map<string, number>;
  branchNudges: Map<string, number>;
  branchMaxDepth: Map<string, number>;
  branchTerminal: Map<string, boolean>;
  enteredBranches: Set<string>;                   // visited a depth>=2 node here
  terminalsReached: Array<{ id: string; rank: number }>; // in visit order
  branchesBeforeDeep: number;                     // distinct branches touched before first depth>=4 move
  perNode: Record<string, number>;
}

// Core path walk: scores every visited node, accumulating per-branch totals and
// the signals the global bonuses need. NO global bonuses applied here.
// `conclusion` maps each branch → the depth at which it counts as "concluded"
// (a terminal reached), so a candidate who drives a branch to its reachable
// frontier gets credit for the terminal without hitting the literal deep leaf.
function walkPath(map: Map<string, IndexedNode>, branchRank: Map<string, number>, traversal: Visit[], conclusion: Map<string, number>): WalkResult {
  const branchPoints = new Map<string, number>();
  const branchContam = new Map<string, number>();
  const branchNudges = new Map<string, number>();
  const branchMaxDepth = new Map<string, number>();
  const branchTerminal = new Map<string, boolean>();
  const enteredBranches = new Set<string>();
  const terminalsReached: Array<{ id: string; rank: number }> = [];
  const branchesTouched = new Set<string>();
  const perNode: Record<string, number> = {};
  let branchesBeforeDeep = 0;
  let firstDeepSeen = false;

  let chain: string[] = [];
  let nudgeCountdown = 0;

  const closeChain = () => {
    if (chain.length >= 3) {
      const tail = chain[chain.length - 1];
      const extra = (perNode[tail] ?? 0) * (chainMult(chain.length) - 1);
      perNode[tail] = (perNode[tail] ?? 0) + extra;
      branchPoints.set(branchOf(tail), (branchPoints.get(branchOf(tail)) ?? 0) + extra);
    }
    chain = [];
  };

  const visits = traversal.filter((v) => v.id != null && map.has(String(v.id)));
  visits.forEach((v) => {
    const node = map.get(String(v.id)) as IndexedNode;
    const br = branchOf(node.id);
    if (!branchPoints.has(br)) { branchPoints.set(br, 0); branchContam.set(br, 0); branchNudges.set(br, 0); branchMaxDepth.set(br, 0); }

    // breadth tracking
    if (node.depth >= 2) branchesTouched.add(br);
    if (node.depth >= 4 && !firstDeepSeen) { firstDeepSeen = true; branchesBeforeDeep = branchesTouched.size; }

    // soft nudge countdown (no stacking — a fresh nudge just resets to 2)
    if (v.was_nudged) { nudgeCountdown = 2; branchNudges.set(br, (branchNudges.get(br) ?? 0) + 1); }
    const nMult = nudgeMultFor(nudgeCountdown);
    if (nudgeCountdown > 0) nudgeCountdown -= 1;

    if (node.status === 'correct') {
      enteredBranches.add(br);
      const base = correctWeight(node.depth);
      const c = decay(branchContam.get(br) ?? 0);
      const last = chain[chain.length - 1];
      const isExt = chain.length > 0 && parentOf(node.id) === last && branchOf(node.id) === branchOf(last);
      if (isExt) chain.push(node.id); else { closeChain(); chain = [node.id]; }
      const s = base * c * nMult;
      perNode[node.id] = s;
      branchPoints.set(br, (branchPoints.get(br) ?? 0) + s);
      branchMaxDepth.set(br, Math.max(branchMaxDepth.get(br) ?? 0, node.depth));
      // Terminal = drove this branch's correct chain to its (reachable) conclusion.
      const concl = conclusion.get(br);
      if (concl != null && node.depth >= concl && !branchTerminal.get(br)) {
        branchTerminal.set(br, true);
        terminalsReached.push({ id: br, rank: branchRank.get(br) ?? 99 });
      }
    } else if (node.status === 'neutral') {
      enteredBranches.add(br);
      const base = Math.floor(correctWeight(node.depth) * 0.3);
      const c = decay(branchContam.get(br) ?? 0);
      const s = base * c * nMult;
      perNode[node.id] = s;
      branchPoints.set(br, (branchPoints.get(br) ?? 0) + s);
      // neutral sibling detour does NOT break the chain
    } else if (node.status === 'explored_wrong') {
      perNode[node.id] = 0;
      branchContam.set(br, (branchContam.get(br) ?? 0) + 1);
      closeChain();
    } else if (node.status === 'dead_end') {
      perNode[node.id] = DEAD_END_PENALTY;
      branchPoints.set(br, (branchPoints.get(br) ?? 0) + DEAD_END_PENALTY);
      branchContam.set(br, (branchContam.get(br) ?? 0) + 1);
      closeChain();
    }
  });
  closeChain();

  const pathPoints = [...branchPoints.values()].reduce((a, b) => a + b, 0);
  return { pathPoints, branchPoints, branchContam, branchNudges, branchMaxDepth, branchTerminal, enteredBranches, terminalsReached, branchesBeforeDeep, perNode };
}

// Flat global bonuses: ordering (did they hit the high-priority branches first),
// coverage (soft — how many terminals reached), structure (scan before diving).
function globalBonuses(w: WalkResult, allTerminalRanks: number[]): number {
  let b = 0;
  const T = allTerminalRanks.length;
  const R = w.terminalsReached.length;

  // ordering (flat points)
  if (w.terminalsReached[0]) {
    const r = w.terminalsReached[0].rank;
    b += r === 1 ? 15 : r === 2 ? 10 : r === 3 ? 5 : 0;
  }
  if (w.terminalsReached[1]) {
    const remaining = [...allTerminalRanks];
    const firstIdx = remaining.indexOf(w.terminalsReached[0].rank);
    if (firstIdx >= 0) remaining.splice(firstIdx, 1);
    const remainingTop = remaining.length ? Math.min(...remaining) : Infinity;
    if (w.terminalsReached[1].rank === remainingTop) b += 5;
  }

  // coverage (soft, reward-only — no penalty for reaching few terminals)
  if (R >= T) b += 30;
  else if (R === T - 1) b += 20;
  else if (R === T - 2) b += 10;

  // structure (scan then dive)
  if (w.branchesBeforeDeep >= 3) b += 15;
  else if (w.branchesBeforeDeep >= 2) b += 10;

  return b;
}

// Ideal traversal: every correct node in parent→child order (capped at the
// reachable frontier), branches in rank order, no nudges/wrong turns. Used to
// compute the per-branch + global max against a depth a candidate can realistically reach.
function idealTraversal(root: RawNode, reach: number): Visit[] {
  const out: Visit[] = [{ id: String(root.id ?? 'root'), was_nudged: false }];
  // Include correct AND neutral nodes — a candidate earns points on both, and
  // correct nodes can live UNDER a neutral (optional) branch. Excluding neutral
  // branches left those correct children out of the max → absurd >100% locals.
  const include = (n: RawNode): boolean => { const s = statusOf(n); return s === 'correct' || s === 'neutral'; };
  const dfs = (n: RawNode) => {
    const kids = (n.children ?? []).filter((c) => include(c) && (c.depth ?? 0) <= reach);
    for (const c of kids) { out.push({ id: String(c.id), was_nudged: false }); dfs(c); }
  };
  const buckets = (root.children ?? []).filter(include).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  for (const bk of buckets) { out.push({ id: String(bk.id), was_nudged: false }); dfs(bk); }
  return out;
}

export function scoreTraversal(root: RawNode, traversal: Visit[]): TreeScore {
  const map = indexTree(root);
  const branchRank = new Map<string, number>();
  for (const n of map.values()) if (n.depth === 1) branchRank.set(n.id, n.rank ?? 99);

  // Deepest correct depth per branch → each branch's reachable "conclusion" depth.
  const branchDeepCorrect = new Map<string, number>();
  for (const n of map.values()) {
    if (n.status === 'correct' && n.depth >= 1) {
      const br = branchOf(n.id);
      branchDeepCorrect.set(br, Math.max(branchDeepCorrect.get(br) ?? 0, n.depth));
    }
  }
  const conclusion = new Map<string, number>();
  for (const [br, d] of branchDeepCorrect) conclusion.set(br, Math.min(d, REACH_DEPTH));

  // One terminal per CORRECT branch (a branch with a real correct chain). Reaching
  // its conclusion depth = "reached the terminal" — matching the 4-branch mental model.
  const correctBranches = [...branchRank.keys()].filter((br) => (branchDeepCorrect.get(br) ?? 0) >= 2);
  const totalTerminals = correctBranches.length;
  const allTerminalRanks = correctBranches.map((br) => branchRank.get(br) ?? 99);

  // Walk candidate + ideal (ideal, capped at the reachable frontier, gives the maxima).
  const actual = walkPath(map, branchRank, traversal, conclusion);
  const idealVisits = idealTraversal(root, REACH_DEPTH);
  const ideal = walkPath(map, branchRank, idealVisits, conclusion);

  const actualGlobal = Math.max(0, Math.round(actual.pathPoints + globalBonuses(actual, allTerminalRanks)));
  const idealGlobal = Math.max(1, Math.round(ideal.pathPoints + globalBonuses(ideal, allTerminalRanks)));
  const globalPct = Math.min(100, Math.round((actualGlobal / idealGlobal) * 1000) / 10);

  // Per-branch local scores (only for branches the candidate entered; others = not explored).
  const local: Record<string, LocalBranch> = {};
  for (const [brId, brRank] of branchRank) {
    void brRank;
    const label = map.get(brId)?.label ?? brId;
    if (!actual.enteredBranches.has(brId)) { local[brId] = { label, not_explored: true }; continue; }
    const pts = Math.max(0, Math.round(actual.branchPoints.get(brId) ?? 0));
    const max = Math.max(1, Math.round(ideal.branchPoints.get(brId) ?? 0));
    const pct = Math.min(100, Math.round((pts / max) * 1000) / 10);
    local[brId] = {
      label, points: pts, max, percentage: pct, grade: branchGrade(pct),
      depth_reached: actual.branchMaxDepth.get(brId) ?? 0,
      terminal_reached: actual.branchTerminal.get(brId) ?? false,
      contamination: actual.branchContam.get(brId) ?? 0,
      nudges: actual.branchNudges.get(brId) ?? 0,
    };
  }

  const strongBranches = Object.values(local).filter((b) => !b.not_explored && (b.percentage ?? 0) >= 70).length;
  const R = actual.terminalsReached.length;

  let grade = gradeMatrix(strongBranches, R);
  if (globalPct < 35) grade = capAt(grade, 'Lean No');
  if (globalPct >= 80) grade = bumpUp(grade);

  const perNodePoints: Record<string, number> = {};
  for (const [k, v] of Object.entries(actual.perNode)) perNodePoints[k] = Math.round(v);

  const idealPath = idealVisits.map((v) => String(v.id)).filter((id) => id !== 'root');

  return {
    global: { score: actualGlobal, max: idealGlobal, percentage: globalPct },
    local,
    terminals_reached: R,
    terminals_total: totalTerminals,
    strong_branches: strongBranches,
    grade,
    idealPath,
    perNodePoints,
  };
}
