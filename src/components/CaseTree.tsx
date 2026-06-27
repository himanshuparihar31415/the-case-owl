import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Panel,
  Handle, Position, useReactFlow, MarkerType,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Star, X, Maximize2, CheckCircle2, MinusCircle, XCircle, Circle } from 'lucide-react';

// Post-interview case map: the candidate's journey overlaid on the full MECE
// answer-key tree. Light theme (matches the report) with high-contrast status
// colours. Opens in a modal with a persistent detail panel, minimap + zoom.

type RawNode = {
  id?: string; label?: string; depth?: number;
  status?: string; reference_status?: string; insight?: string;
  candidate_status?: string; quality?: string;
  evaluation_note?: string; note?: string;
  candidate_quotes?: string[]; recommended_path?: string;
  exhibit_shared?: string; time_spent?: string; was_nudged?: boolean;
  points?: number; rank?: number;
  children?: RawNode[];
};

type Lens = 'journey' | 'score';

interface NodeData extends Record<string, unknown> {
  label: string; depth: number; status: string; candidateStatus: string;
  quality?: string; insight?: string; star: boolean; timeSpent?: string;
  wasNudged?: boolean; hasChildren: boolean; collapsed: boolean; dimmed: boolean; selected: boolean;
  points?: number; rank?: number; lens: Lens;
}

const NODE_W = 210;
const NODE_H = 72;

const refStatus = (n: RawNode): string => n.reference_status ?? n.status ?? 'neutral';

// Light-theme palette — bold accents that contrast against the white canvas.
function palette(status: string) {
  switch (status) {
    case 'correct': return { accent: 'bg-emerald-500', border: 'border-emerald-500', text: 'text-slate-800', bg: 'bg-emerald-50' };
    case 'explored_wrong': return { accent: 'bg-slate-400', border: 'border-slate-300', text: 'text-slate-500', bg: 'bg-white' };
    case 'dead_end': return { accent: 'bg-red-500', border: 'border-red-300', text: 'text-slate-400', bg: 'bg-red-50/60' };
    default: return { accent: 'bg-sky-500', border: 'border-sky-300', text: 'text-slate-700', bg: 'bg-sky-50/60' };
  }
}

function candIcon(cs: string) {
  switch (cs) {
    case 'explored': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
    case 'mentioned': return <Circle className="w-3.5 h-3.5 text-emerald-500" />;
    case 'wrong_turn': return <MinusCircle className="w-3.5 h-3.5 text-amber-500" />;
    case 'dead_end_hit': return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    default: return null; // skipped
  }
}

function qualityChip(q?: string) {
  if (!q || q === 'n/a') return null;
  const map: Record<string, string> = {
    strong: 'bg-emerald-100 text-emerald-700', adequate: 'bg-lime-100 text-lime-700',
    weak: 'bg-amber-100 text-amber-700', wrong: 'bg-red-100 text-red-700',
  };
  return <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${map[q] ?? 'bg-slate-100 text-slate-600'}`}>{q}</span>;
}

function PointsBadge({ pts, status }: { pts?: number; status: string }) {
  if (pts == null) return status === 'explored_wrong' ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">0</span> : null;
  const cls = pts > 0 ? 'bg-emerald-100 text-emerald-700' : pts < 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{pts > 0 ? `+${pts}` : pts}</span>;
}

function CaseNode({ data }: NodeProps<Node<NodeData>>) {
  const p = palette(data.status);
  const skipped = data.candidateStatus === 'skipped';
  return (
    <div
      title={data.insight}
      className={`group relative flex overflow-hidden rounded-xl border-2 ${p.border} ${p.bg} shadow-sm transition-all
        ${data.dimmed ? 'opacity-25' : skipped ? 'opacity-60' : 'opacity-100'} ${data.selected ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className={`w-1.5 shrink-0 ${p.accent}`} />
      <div className="flex-1 px-3 py-2.5 min-w-0">
        <div className="flex items-center gap-1.5">
          {data.lens === 'score' && data.rank != null && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 rounded px-1">#{data.rank}</span>}
          <div className={`text-[13px] font-semibold leading-snug ${p.text} ${data.status === 'dead_end' ? 'line-through' : ''}`}>{data.label}</div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {data.lens === 'score' ? (
            <PointsBadge pts={data.points} status={data.status} />
          ) : (
            <>{candIcon(data.candidateStatus)}{qualityChip(data.quality)}</>
          )}
          {data.timeSpent && <span className="text-[10px] text-slate-400">{data.timeSpent}</span>}
          {data.wasNudged && <span className="text-[9px] uppercase tracking-wide text-amber-600">nudged</span>}
        </div>
      </div>
      <span className="absolute top-1.5 right-2 text-[10px] font-bold text-slate-400">{data.depth}</span>
      {data.star && <Star className="absolute top-1.5 right-6 w-3.5 h-3.5 text-amber-500 fill-amber-400" />}
      {data.hasChildren && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white border border-slate-300 text-[10px] leading-[14px] text-center text-slate-500">
          {data.collapsed ? '+' : '–'}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { caseNode: CaseNode };

function edgeColor(status: string) {
  switch (status) {
    case 'correct': return { stroke: '#059669', dashed: false, w: 2.5 };
    case 'explored_wrong': return { stroke: '#94a3b8', dashed: true, w: 1.5 };
    case 'dead_end': return { stroke: '#dc2626', dashed: true, w: 1.5 };
    default: return { stroke: '#0ea5e9', dashed: true, w: 1.5 };
  }
}
const miniColor = (status: string) => (status === 'correct' ? '#10b981' : status === 'dead_end' ? '#ef4444' : status === 'neutral' ? '#0ea5e9' : '#94a3b8');

function flatten(root: RawNode): Array<{ id: string; raw: RawNode; parentId: string | null }> {
  const out: Array<{ id: string; raw: RawNode; parentId: string | null }> = [];
  const walk = (n: RawNode, parentId: string | null, path: string) => {
    const id = n.id ?? path;
    out.push({ id, raw: n, parentId });
    (n.children ?? []).forEach((c, i) => walk(c, id, `${path}.${i}`));
  };
  walk(root, null, 'root');
  return out;
}

function buildGraph(root: RawNode, collapsed: Set<string>, solutionOnly: boolean, selectedId: string | null, lens: Lens) {
  const all = flatten(root);
  const byId = new Map(all.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  all.forEach((n) => { if (n.parentId) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]); });
  const hidden = new Set<string>();
  const hideDesc = (id: string) => (childrenOf.get(id) ?? []).forEach((c) => { hidden.add(c); hideDesc(c); });
  collapsed.forEach((id) => hideDesc(id));
  const visible = all.filter((n) => !hidden.has(n.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 100, marginx: 28, marginy: 28 });
  g.setDefaultEdgeLabel(() => ({}));
  visible.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  visible.forEach((n) => { if (n.parentId && byId.has(n.parentId) && !hidden.has(n.parentId)) g.setEdge(n.parentId, n.id); });
  dagre.layout(g);

  const nodes: Node<NodeData>[] = visible.map((n) => {
    const pos = g.node(n.id);
    const status = refStatus(n.raw);
    const hasChildren = (childrenOf.get(n.id) ?? []).length > 0;
    return {
      id: n.id, type: 'caseNode',
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: {
        label: n.raw.label ?? '—', depth: n.raw.depth ?? 0, status,
        candidateStatus: n.raw.candidate_status ?? 'skipped', quality: n.raw.quality, insight: n.raw.insight,
        star: status === 'correct' && !hasChildren && (n.raw.depth ?? 0) >= 6,
        timeSpent: n.raw.time_spent, wasNudged: n.raw.was_nudged,
        points: n.raw.points, rank: n.raw.rank, lens,
        hasChildren, collapsed: collapsed.has(n.id),
        dimmed: solutionOnly && status !== 'correct', selected: selectedId === n.id,
      },
    };
  });

  const edges: Edge[] = visible.filter((n) => n.parentId && !hidden.has(n.parentId)).map((n) => {
    const status = refStatus(n.raw);
    const { stroke, dashed, w } = edgeColor(status);
    const dim = solutionOnly && status !== 'correct';
    return {
      id: `${n.parentId}->${n.id}`, source: n.parentId as string, target: n.id, type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 13, height: 13 },
      style: { stroke, strokeWidth: w, strokeDasharray: dashed ? '6 5' : undefined, opacity: dim ? 0.2 : 1 },
    };
  });
  return { nodes, edges };
}

const REF_LABEL: Record<string, { t: string; c: string }> = {
  correct: { t: 'On the solution path', c: 'text-emerald-600' },
  explored_wrong: { t: 'Wrong turn', c: 'text-amber-600' },
  dead_end: { t: 'Dead end', c: 'text-red-600' },
  neutral: { t: 'Optional context', c: 'text-sky-600' },
};
const CAND_LABEL: Record<string, string> = {
  explored: 'You explored this', mentioned: 'You mentioned it briefly',
  skipped: 'You did not go here', wrong_turn: 'You went down this path', dead_end_hit: 'You hit this dead end',
};

function Detail({ node, summary }: { node: RawNode | null; summary?: Record<string, any> }) {
  if (!node) {
    return (
      <div className="space-y-4 text-sm">
        {summary?.overall_rating && <p className="font-bold text-slate-800 leading-relaxed">{summary.overall_rating}</p>}
        {summary && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {([
              ['Explored', `${summary.nodes_explored ?? '—'} / ${summary.total_nodes_in_reference ?? '—'}`],
              ['Max depth', summary.max_depth_on_correct_path],
              ['Wrong turns', summary.wrong_turns_taken],
              ['Dead ends', summary.dead_ends_hit],
              ['Traps avoided', summary.nodes_skipped_wrong],
              ['Nudges', summary.nudges_given],
            ] as [string, any][]).filter(([, v]) => v != null).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-slate-200 py-1"><span className="text-slate-500">{k}</span><span className="text-slate-800 font-semibold">{String(v)}</span></div>
            ))}
          </div>
        )}
        {Array.isArray(summary?.key_insight_missed) && summary.key_insight_missed.length > 0 && (
          <p className="text-xs text-red-600"><span className="font-bold">Missed: </span>{summary.key_insight_missed.join('; ')}</p>
        )}
        <p className="text-xs text-slate-500 pt-2 border-t border-slate-200">Click any node to see the right move there and how you did.</p>
      </div>
    );
  }
  const rs = REF_LABEL[refStatus(node)] ?? REF_LABEL.neutral;
  const quotes = Array.isArray(node.candidate_quotes) ? node.candidate_quotes : [];
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-bold text-slate-900">{node.label}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-[11px] font-semibold ${rs.c}`}>{rs.t}</span>
          <span className="text-[11px] text-slate-500">· {CAND_LABEL[node.candidate_status ?? 'skipped']}</span>
          {node.points != null && <PointsBadge pts={node.points} status={refStatus(node)} />}
        </div>
      </div>
      {node.insight && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold mb-1">What good looks like here</p>
          <p className="text-slate-700 text-[13px] leading-relaxed">{node.insight}</p>
        </div>
      )}
      {(quotes.length > 0 || node.evaluation_note) && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">What you did</p>
          {quotes.map((q, i) => <p key={i} className="text-slate-500 text-xs italic border-l-2 border-slate-300 pl-2">“{q}”</p>)}
          {node.evaluation_note && <p className="text-slate-700 text-[13px] leading-relaxed">{node.evaluation_note}</p>}
        </div>
      )}
      {node.recommended_path && (
        <div className="rounded-lg border border-dashed border-emerald-400 bg-emerald-50/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-bold mb-1">Recommended path</p>
          <p className="text-emerald-800 text-[13px] leading-relaxed">{node.recommended_path}</p>
        </div>
      )}
      {node.exhibit_shared && <p className="text-[11px] text-slate-500">Exhibits shared here: {node.exhibit_shared}</p>}
    </div>
  );
}

const GRADE_COLOR: Record<string, string> = {
  'Strong Hire': 'text-emerald-600', 'Hire': 'text-emerald-600', 'Borderline': 'text-amber-600',
  'Lean No': 'text-orange-600', 'No Hire': 'text-red-600',
};

function ScoreCard({ score }: { score?: Record<string, any> }) {
  if (!score) return <p className="text-xs text-slate-500">No score available for this report.</p>;
  const pct = score.percentage ?? 0;
  const branches: Record<string, any> = score.branch_scores ?? {};
  const pen = score.penalties ?? {};
  const cov = score.coverage ?? {};
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className={`text-2xl font-extrabold ${GRADE_COLOR[score.grade] ?? 'text-slate-800'}`}>{score.grade ?? '—'}</p>
        <p className="text-slate-500 text-xs mt-0.5">{score.total} / {score.max} pts · {pct}%</p>
        <div className="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
          <div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1.5">Branch scores</p>
        <div className="space-y-1.5">
          {Object.values(branches).map((b: any, i) => (
            <div key={i} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-slate-700 truncate">{b.label}</span>
                <span className="text-slate-900 font-semibold shrink-0">{b.final} pts</span>
              </div>
              <div className="flex gap-2 text-[10px] text-slate-400">
                <span>depth {b.depthReached}</span>
                {b.terminalReached && <span className="text-emerald-600">✓ terminal</span>}
                {b.ordering !== 1 && <span className="text-amber-600">×{b.ordering} order</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-xs text-slate-500 space-y-1 border-t border-slate-200 pt-2">
        <p>Terminals reached: <span className="text-slate-800">{cov.terminals_reached ?? '—'}</span> (cov {cov.coverage_points >= 0 ? '+' : ''}{cov.coverage_points ?? 0})</p>
        <p>Wrong turns: <span className="text-slate-800">{(pen.wrong_turns ?? []).length}</span> · Dead ends: <span className="text-slate-800">{(pen.dead_ends_hit ?? []).length}</span> · Nudges: <span className="text-slate-800">{pen.nudges_given ?? 0}</span></p>
        {pen.nudge_point_reduction ? <p className="text-amber-600">Nudge penalty: {pen.nudge_point_reduction}</p> : null}
        {Array.isArray(cov.branches_never_entered) && cov.branches_never_entered.length > 0 && (
          <p className="text-red-600">Never entered: {cov.branches_never_entered.join(', ')}</p>
        )}
      </div>
      <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">Each node shows the points it earned. Click one for the full breakdown.</p>
    </div>
  );
}

function Flow({ root, summary, score }: { root: RawNode; summary?: Record<string, any>; score?: Record<string, any> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [solutionOnly, setSolutionOnly] = useState(false);
  const [selected, setSelected] = useState<RawNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.55);
  const [lens, setLens] = useState<Lens>('journey');
  const rf = useReactFlow();
  const allNodes = useMemo(() => flatten(root), [root]);
  const { nodes, edges } = useMemo(() => buildGraph(root, collapsed, solutionOnly, selectedId, lens), [root, collapsed, solutionOnly, selectedId, lens]);

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 60); return () => clearTimeout(t); }, [collapsed, rf]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const f = allNodes.find((n) => n.id === node.id);
    setSelected(f ? f.raw : null); setSelectedId(node.id);
  }, [allNodes]);
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; });
  }, []);
  const focusSolution = () => { const n = new Set<string>(); allNodes.forEach((x) => { if (refStatus(x.raw) !== 'correct') n.add(x.id); }); setCollapsed(n); setSolutionOnly(true); };
  const btn = 'text-xs px-3 py-1.5 rounded-md border bg-white transition';

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1 min-w-0">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
          onMove={(_, vp) => setZoom(vp.zoom)}
          fitView minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }}
          style={{ background: '#f8fafc' }}
        >
          <Background variant={BackgroundVariant.Dots} color="#cbd5e1" gap={26} size={1.5} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => miniColor(((n.data as NodeData)?.status) ?? 'neutral')} maskColor="rgba(241,245,249,0.6)" className="!bg-white !border !border-slate-200" />
          <Panel position="top-left" className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-slate-300 overflow-hidden">
              <button onClick={() => setLens('journey')} className={`text-xs px-3 py-1.5 ${lens === 'journey' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'}`}>Journey</button>
              <button onClick={() => setLens('score')} className={`text-xs px-3 py-1.5 ${lens === 'score' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'}`}>Score</button>
            </div>
            <button onClick={() => setSolutionOnly((s) => !s)} className={`${btn} ${solutionOnly ? 'border-emerald-500 text-emerald-600' : 'border-slate-300 text-slate-500'}`}>Solution Path</button>
            <button onClick={() => { setCollapsed(new Set()); setSolutionOnly(false); }} className={`${btn} border-slate-300 text-slate-500`}>Expand All</button>
            <button onClick={focusSolution} className={`${btn} border-slate-300 text-slate-500`}>Focus Solution</button>
          </Panel>
          <Panel position="bottom-left" className="flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-1.5 shadow-sm">
            <span className="text-[11px] text-slate-500">zoom</span>
            <input type="range" min={0.15} max={1.5} step={0.05} value={zoom}
              onChange={(e) => { const z = +e.target.value; setZoom(z); rf.zoomTo(z, { duration: 120 }); }} className="w-32 accent-emerald-500" />
          </Panel>
          <Panel position="top-right" className="flex gap-3 text-[11px] text-slate-600 bg-white px-3 py-1.5 rounded-md border border-slate-200 shadow-sm">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />correct</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" />wrong</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />dead end</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500" />optional</span>
          </Panel>
        </ReactFlow>
      </div>
      <aside className="w-[360px] shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4">
        {lens === 'score' && !selected ? <ScoreCard score={score} /> : <Detail node={selected} summary={summary} />}
      </aside>
    </div>
  );
}

export default function CaseTree({ root, summary, score }: { root: RawNode; summary?: Record<string, any>; score?: Record<string, any> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!root) return null;

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 text-emerald-700 font-medium py-6 hover:bg-emerald-50 transition">
        <Maximize2 className="w-4 h-4" /> Open interactive case map
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-slate-900/40 flex p-3 sm:p-6">
          <div className="m-auto w-full h-full max-w-[1500px] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 shrink-0">
              <p className="text-sm font-bold text-slate-800">Case Map — your path vs. the answer key</p>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 min-h-0">
              <ReactFlowProvider><Flow root={root} summary={summary} score={score} /></ReactFlowProvider>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
