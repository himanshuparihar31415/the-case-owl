// Deterministic tree-traversal scoring engine (no LLM, pure math). Walks the
// candidate's ordered node-visit list against the reference tree and produces a
// score + diagnostic breakdown + per-node points (for the Case Map viz).
// Implements THE CASE OWL "Tree Traversal Scoring Engine" spec.

type RawNode = {
  id?: string; label?: string; depth?: number;
  status?: string; reference_status?: string; rank?: number;
  children?: RawNode[];
};
type Visit = { id?: string; was_nudged?: boolean };

interface IndexedNode { id: string; label: string; status: string; depth: number; rank?: number; hasCorrectChild: boolean }

// --- weight tables (spec §1) ---
const CORRECT_W: Record<number, number> = { 0: 0, 1: 5, 2: 10, 3: 20, 4: 35, 5: 55, 6: 75, 7: 95, 8: 120 };
const correctWeight = (d: number): number => CORRECT_W[d] ?? (d > 8 ? 120 : 0);
function weightFor(status: string, d: number): number {
  if (status === 'correct') return correctWeight(d);
  if (status === 'neutral') return Math.floor(correctWeight(d) * 0.3);
  return 0;
}
const deadEndPenalty = (d: number): number => (d <= 2 ? -10 : d === 3 ? -20 : -35);
const chainMult = (len: number): number => (len >= 7 ? 1.7 : len === 6 ? 1.5 : len === 5 ? 1.35 : len === 4 ? 1.2 : len === 3 ? 1.1 : 1.0);
const decay = (c: number): number => (c <= 0 ? 1.0 : c === 1 ? 0.75 : c === 2 ? 0.55 : c === 3 ? 0.4 : 0.25);

const statusOf = (n: RawNode): string => n.reference_status ?? n.status ?? 'neutral';
const branchOf = (id: string): string => (id === 'root' ? 'root' : id.split('.')[0]);
const parentOf = (id: string): string => { const p = id.split('.'); return p.length <= 1 ? 'root' : p.slice(0, -1).join('.'); };

function indexTree(root: RawNode): Map<string, IndexedNode> {
  const map = new Map<string, IndexedNode>();
  const walk = (n: RawNode) => {
    const children = n.children ?? [];
    const hasCorrectChild = children.some((c) => statusOf(c) === 'correct');
    map.set(String(n.id), { id: String(n.id), label: n.label ?? '', status: statusOf(n), depth: n.depth ?? 0, rank: n.rank, hasCorrectChild });
    children.forEach(walk);
  };
  walk(root);
  return map;
}

export interface TreeScore {
  total: number; max: number; percentage: number; grade: string;
  branch_scores: Record<string, { label: string; raw: number; ordering: number; final: number; depthReached: number; terminalReached: boolean }>;
  penalties: { dead_ends_hit: Array<{ node: string; penalty: number }>; wrong_turns: string[]; nudges_given: number; nudge_point_reduction: number };
  coverage: { terminals_reached: string; coverage_points: number; branches_never_entered: string[] };
  perNodePoints: Record<string, number>;
}

function gradeFor(pct: number): string {
  if (pct >= 85) return 'Strong Hire';
  if (pct >= 70) return 'Hire';
  if (pct >= 55) return 'Borderline';
  if (pct >= 40) return 'Lean No';
  return 'No Hire';
}

// Core walk. Returns total path score + diagnostics + per-node points.
function walk(root: RawNode, traversal: Visit[]): Omit<TreeScore, 'max' | 'percentage' | 'grade'> {
  const map = indexTree(root);
  const branchRank = new Map<string, number>();
  for (const n of map.values()) if (n.depth === 1) branchRank.set(n.id, n.rank ?? 99);

  const branchRaw = new Map<string, number>();
  const contam = new Map<string, number>();
  const perNode: Record<string, number> = {};
  const deepest = new Map<string, number>();        // deepest CORRECT depth per branch
  const firstDeepIdx = new Map<string, number>();   // for ordering bonus
  const terminalsReached = new Set<string>();
  const penalties = { dead_ends_hit: [] as Array<{ node: string; penalty: number }>, wrong_turns: [] as string[], nudges_given: 0, nudge_point_reduction: 0 };

  let chain: string[] = [];
  let nudgeCountdown = 0;

  const closeChain = () => {
    if (chain.length >= 3) {
      const tail = chain[chain.length - 1];
      const m = chainMult(chain.length);
      const extra = (perNode[tail] ?? 0) * (m - 1);
      perNode[tail] = (perNode[tail] ?? 0) + extra;
      branchRaw.set(branchOf(tail), (branchRaw.get(branchOf(tail)) ?? 0) + extra);
    }
    chain = [];
  };

  const visits = traversal.filter((v) => v.id != null && map.has(String(v.id)));
  visits.forEach((v, idx) => {
    const node = map.get(String(v.id)) as IndexedNode;
    const br = branchOf(node.id);

    // nudge countdown (spec §7a/b)
    if (v.was_nudged) { nudgeCountdown = 2; penalties.nudges_given += 1; } else { nudgeCountdown = Math.max(0, nudgeCountdown - 1); }
    const nudgeMult = nudgeCountdown === 2 ? 0.5 : nudgeCountdown === 1 ? 0.75 : 1.0;

    if (node.status === 'correct') {
      const base = correctWeight(node.depth);
      const c = decay(contam.get(br) ?? 0);
      const last = chain[chain.length - 1];
      const isExt = chain.length > 0 && parentOf(node.id) === last && branchOf(node.id) === branchOf(last);
      if (isExt) chain.push(node.id); else { closeChain(); chain = [node.id]; }
      const s = base * c * nudgeMult;
      perNode[node.id] = s;
      branchRaw.set(br, (branchRaw.get(br) ?? 0) + s);
      penalties.nudge_point_reduction += base * c - s;
      deepest.set(br, Math.max(deepest.get(br) ?? 0, node.depth));
      if (node.depth >= 3 && !firstDeepIdx.has(br)) firstDeepIdx.set(br, idx);
      if (!node.hasCorrectChild) terminalsReached.add(node.id);
    } else if (node.status === 'neutral') {
      const base = weightFor('neutral', node.depth);
      const c = decay(contam.get(br) ?? 0);
      const s = base * c * nudgeMult;
      perNode[node.id] = s;
      branchRaw.set(br, (branchRaw.get(br) ?? 0) + s);
      penalties.nudge_point_reduction += base * c - s;
      // neutral sibling detour does NOT break the chain
    } else if (node.status === 'explored_wrong') {
      perNode[node.id] = 0;
      contam.set(br, (contam.get(br) ?? 0) + 1);
      penalties.wrong_turns.push(node.id);
      closeChain();
    } else if (node.status === 'dead_end') {
      const pen = deadEndPenalty(node.depth);
      perNode[node.id] = pen;
      branchRaw.set(br, (branchRaw.get(br) ?? 0) + pen);
      contam.set(br, (contam.get(br) ?? 0) + 2);
      penalties.dead_ends_hit.push({ node: node.id, penalty: pen });
      closeChain();
    }
  });
  closeChain();

  // Branch ordering bonus (spec §4)
  const deepBranches = [...firstDeepIdx.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  const orderingMult = new Map<string, number>();
  deepBranches.forEach((br, pos) => {
    const rank = branchRank.get(br) ?? 99;
    if (pos === 0) orderingMult.set(br, rank === 1 ? 1.25 : rank === 2 ? 1.15 : rank === 3 ? 1.05 : 1.0);
    else if (pos === 1) {
      const remaining = deepBranches.slice(1).map((b) => branchRank.get(b) ?? 99);
      orderingMult.set(br, rank === Math.min(...remaining) ? 1.1 : 1.0);
    } else orderingMult.set(br, 1.0);
  });

  // Coverage (spec §5)
  const terminals = [...map.values()].filter((n) => n.status === 'correct' && !n.hasCorrectChild);
  const totalTerminals = terminals.length;
  const reached = terminalsReached.size;
  let coveragePoints = 0;
  if (totalTerminals > 0) {
    if (reached >= totalTerminals) coveragePoints += 50;
    else if (reached >= totalTerminals * 0.75) coveragePoints += 25;
    else if (reached >= totalTerminals * 0.5) coveragePoints += 5;
    else if (reached < 1) coveragePoints -= 30;
  }
  const branchTerminalDepth = new Map<string, number>();
  terminals.forEach((t) => branchTerminalDepth.set(branchOf(t.id), Math.max(branchTerminalDepth.get(branchOf(t.id)) ?? 0, t.depth)));
  const neverEntered: string[] = [];
  for (const br of branchRank.keys()) {
    const tDepth = branchTerminalDepth.get(br) ?? 0;
    const rd = deepest.get(br);
    if (rd == null) { coveragePoints -= 10; neverEntered.push(map.get(br)?.label ?? br); continue; }
    if (tDepth && rd >= tDepth) coveragePoints += 15;
    else if (tDepth && rd >= tDepth - 1) coveragePoints += 8;
    else if (tDepth && rd >= tDepth - 2) coveragePoints += 3;
  }

  // Assemble branch_scores + path total
  const branch_scores: TreeScore['branch_scores'] = {};
  let pathTotal = 0;
  for (const [br, raw] of branchRaw) {
    const mult = orderingMult.get(br) ?? 1.0;
    const final = raw * mult;
    pathTotal += final;
    const node = map.get(br);
    branch_scores[br] = {
      label: node?.label ?? br, raw: Math.round(raw), ordering: mult, final: Math.round(final),
      depthReached: deepest.get(br) ?? 0,
      terminalReached: terminals.some((t) => branchOf(t.id) === br && terminalsReached.has(t.id)),
    };
  }

  const total = Math.round(pathTotal + coveragePoints);
  const rounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(perNode)) rounded[k] = Math.round(v);
  penalties.nudge_point_reduction = -Math.round(penalties.nudge_point_reduction);

  return {
    total, branch_scores, penalties,
    coverage: { terminals_reached: `${reached}/${totalTerminals}`, coverage_points: Math.round(coveragePoints), branches_never_entered: neverEntered },
    perNodePoints: rounded,
  };
}

// Ideal traversal: every correct node in parent→child order, branches in rank
// order, no nudges, no wrong turns. Used to compute the max possible score.
function idealTraversal(root: RawNode): Visit[] {
  const out: Visit[] = [{ id: String(root.id ?? 'root'), was_nudged: false }];
  const dfsCorrect = (n: RawNode) => {
    const kids = (n.children ?? []).filter((c) => statusOf(c) === 'correct');
    for (const c of kids) { out.push({ id: String(c.id), was_nudged: false }); dfsCorrect(c); }
  };
  const buckets = (root.children ?? []).filter((c) => statusOf(c) === 'correct').sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  for (const b of buckets) { out.push({ id: String(b.id), was_nudged: false }); dfsCorrect(b); }
  return out;
}

export function scoreTraversal(root: RawNode, traversal: Visit[]): TreeScore {
  const actual = walk(root, traversal);
  const ideal = walk(root, idealTraversal(root)).total;
  const max = Math.max(1, ideal);
  const percentage = Math.round((actual.total / max) * 1000) / 10;
  return { ...actual, max, percentage, grade: gradeFor(percentage) };
}
