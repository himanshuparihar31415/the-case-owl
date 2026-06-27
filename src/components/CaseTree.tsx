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
// answer-key tree. Opens in a modal with a persistent detail panel (the right
// move at each node + how the candidate did), a minimap and a zoom slider.

type RawNode = {
  id?: string; label?: string; depth?: number;
  status?: string; reference_status?: string; insight?: string;
  candidate_status?: string; quality?: string;
  evaluation_note?: string; note?: string;
  candidate_quotes?: string[]; recommended_path?: string;
  exhibit_shared?: string; time_spent?: string; was_nudged?: boolean;
  children?: RawNode[];
};

interface NodeData extends Record<string, unknown> {
  label: string; depth: number; status: string; candidateStatus: string;
  quality?: string; insight?: string; star: boolean; timeSpent?: string;
  wasNudged?: boolean; hasChildren: boolean; collapsed: boolean; dimmed: boolean; selected: boolean;
}

const NODE_W = 210;
const NODE_H = 72;

const refStatus = (n: RawNode): string => n.reference_status ?? n.status ?? 'neutral';

function palette(status: string) {
  switch (status) {
    case 'correct': return { accent: 'bg-emerald-400', border: 'border-emerald-500/70', text: 'text-emerald-50' };
    case 'explored_wrong': return { accent: 'bg-zinc-500', border: 'border-zinc-600/70', text: 'text-zinc-300' };
    case 'dead_end': return { accent: 'bg-zinc-700', border: 'border-zinc-700', text: 'text-zinc-500' };
    default: return { accent: 'bg-sky-400/70', border: 'border-sky-600/50', text: 'text-sky-100/80' };
  }
}

// Tiny icon for how the candidate handled the node.
function candIcon(cs: string) {
  switch (cs) {
    case 'explored': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'mentioned': return <Circle className="w-3.5 h-3.5 text-emerald-300/70" />;
    case 'wrong_turn': return <MinusCircle className="w-3.5 h-3.5 text-amber-400" />;
    case 'dead_end_hit': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    default: return null; // skipped
  }
}

function qualityChip(q?: string) {
  if (!q || q === 'n/a') return null;
  const map: Record<string, string> = {
    strong: 'bg-emerald-500/20 text-emerald-300', adequate: 'bg-lime-500/20 text-lime-300',
    weak: 'bg-amber-500/20 text-amber-300', wrong: 'bg-red-500/20 text-red-300',
  };
  return <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${map[q] ?? 'bg-zinc-600/30 text-zinc-300'}`}>{q}</span>;
}

function CaseNode({ data }: NodeProps<Node<NodeData>>) {
  const p = palette(data.status);
  const skipped = data.candidateStatus === 'skipped';
  return (
    <div
      title={data.insight}
      className={`group relative flex overflow-hidden rounded-xl border ${p.border} bg-[#131a17] shadow-lg transition-all
        ${data.dimmed ? 'opacity-20' : skipped ? 'opacity-55' : 'opacity-100'} ${data.selected ? 'ring-2 ring-emerald-400' : ''}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className={`w-1.5 shrink-0 ${p.accent}`} />
      <div className="flex-1 px-3 py-2.5 min-w-0">
        <div className={`text-[13px] font-semibold leading-snug ${p.text} ${data.status === 'dead_end' ? 'line-through' : ''}`}>{data.label}</div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {candIcon(data.candidateStatus)}
          {qualityChip(data.quality)}
          {data.timeSpent && <span className="text-[10px] text-zinc-500">{data.timeSpent}</span>}
          {data.wasNudged && <span className="text-[9px] uppercase tracking-wide text-amber-400/80">nudged</span>}
        </div>
      </div>
      <span className="absolute top-1.5 right-2 text-[10px] font-bold text-zinc-600">{data.depth}</span>
      {data.star && <Star className="absolute top-1.5 right-6 w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
      {data.hasChildren && (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#0b0f0d] border border-zinc-600 text-[10px] leading-[14px] text-center text-zinc-400">
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
    case 'correct': return { stroke: '#34d399', dashed: false, w: 2.5 };
    case 'explored_wrong': return { stroke: '#a1a1aa', dashed: true, w: 1.5 };
    case 'dead_end': return { stroke: '#52525b', dashed: true, w: 1.5 };
    default: return { stroke: '#38bdf8', dashed: true, w: 1.5 };
  }
}

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

function buildGraph(root: RawNode, collapsed: Set<string>, solutionOnly: boolean, selectedId: string | null) {
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
      style: { stroke, strokeWidth: w, strokeDasharray: dashed ? '6 5' : undefined, opacity: dim ? 0.15 : 0.9 },
    };
  });
  return { nodes, edges };
}

const REF_LABEL: Record<string, { t: string; c: string }> = {
  correct: { t: 'On the solution path', c: 'text-emerald-400' },
  explored_wrong: { t: 'Wrong turn', c: 'text-amber-400' },
  dead_end: { t: 'Dead end', c: 'text-red-400' },
  neutral: { t: 'Optional context', c: 'text-sky-400' },
};
const CAND_LABEL: Record<string, string> = {
  explored: 'You explored this', mentioned: 'You mentioned it briefly',
  skipped: 'You did not go here', wrong_turn: 'You went down this path', dead_end_hit: 'You hit this dead end',
};

// Persistent detail panel — the heart of "make the candidate understand".
function Detail({ node, summary }: { node: RawNode | null; summary?: Record<string, any> }) {
  if (!node) {
    return (
      <div className="space-y-4 text-sm">
        {summary?.overall_rating && <p className="font-bold text-zinc-100 leading-relaxed">{summary.overall_rating}</p>}
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
              <div key={k} className="flex justify-between border-b border-zinc-800 py-1"><span className="text-zinc-500">{k}</span><span className="text-zinc-200 font-semibold">{String(v)}</span></div>
            ))}
          </div>
        )}
        {Array.isArray(summary?.key_insight_missed) && summary.key_insight_missed.length > 0 && (
          <p className="text-xs text-red-400"><span className="font-bold">Missed: </span>{summary.key_insight_missed.join('; ')}</p>
        )}
        <p className="text-xs text-zinc-500 pt-2 border-t border-zinc-800">Click any node to see the right move there and how you did.</p>
      </div>
    );
  }
  const rs = REF_LABEL[refStatus(node)] ?? REF_LABEL.neutral;
  const quotes = Array.isArray(node.candidate_quotes) ? node.candidate_quotes : [];
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-bold text-zinc-100">{node.label}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[11px] font-semibold ${rs.c}`}>{rs.t}</span>
          <span className="text-[11px] text-zinc-500">· {CAND_LABEL[node.candidate_status ?? 'skipped']}</span>
        </div>
      </div>
      {node.insight && (
        <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400 font-bold mb-1">What good looks like here</p>
          <p className="text-zinc-200 text-[13px] leading-relaxed">{node.insight}</p>
        </div>
      )}
      {(quotes.length > 0 || node.evaluation_note) && (
        <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 font-bold">What you did</p>
          {quotes.map((q, i) => <p key={i} className="text-zinc-400 text-xs italic border-l-2 border-zinc-700 pl-2">“{q}”</p>)}
          {node.evaluation_note && <p className="text-zinc-300 text-[13px] leading-relaxed">{node.evaluation_note}</p>}
        </div>
      )}
      {node.recommended_path && (
        <div className="rounded-lg border border-dashed border-emerald-600/50 p-3">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400 font-bold mb-1">Recommended path</p>
          <p className="text-emerald-200/90 text-[13px] leading-relaxed">{node.recommended_path}</p>
        </div>
      )}
      {node.exhibit_shared && <p className="text-[11px] text-zinc-500">Exhibits shared here: {node.exhibit_shared}</p>}
    </div>
  );
}

function Flow({ root, summary }: { root: RawNode; summary?: Record<string, any> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [solutionOnly, setSolutionOnly] = useState(false);
  const [selected, setSelected] = useState<RawNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.55);
  const rf = useReactFlow();
  const allNodes = useMemo(() => flatten(root), [root]);
  const { nodes, edges } = useMemo(() => buildGraph(root, collapsed, solutionOnly, selectedId), [root, collapsed, solutionOnly, selectedId]);

  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 60); return () => clearTimeout(t); }, [collapsed, rf]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const f = allNodes.find((n) => n.id === node.id);
    setSelected(f ? f.raw : null); setSelectedId(node.id);
  }, [allNodes]);
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; });
  }, []);
  const focusSolution = () => { const n = new Set<string>(); allNodes.forEach((x) => { if (refStatus(x.raw) !== 'correct') n.add(x.id); }); setCollapsed(n); setSolutionOnly(true); };
  const btn = 'text-xs px-3 py-1.5 rounded-md border bg-[#0b0f0d]/90 transition';

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1 min-w-0">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
          onMove={(_, vp) => setZoom(vp.zoom)}
          fitView minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} color="#243029" gap={26} size={1.5} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => palette(((n.data as NodeData)?.status) ?? 'neutral').accent.replace('bg-', '').includes('emerald') ? '#34d399' : '#52525b'} className="!bg-[#0b0f0d] !border !border-zinc-800" />
          <Panel position="top-left" className="flex flex-wrap gap-2">
            <button onClick={() => setSolutionOnly((s) => !s)} className={`${btn} ${solutionOnly ? 'border-emerald-500 text-emerald-400' : 'border-zinc-700 text-zinc-400'}`}>Solution Path</button>
            <button onClick={() => { setCollapsed(new Set()); setSolutionOnly(false); }} className={`${btn} border-zinc-700 text-zinc-400`}>Expand All</button>
            <button onClick={focusSolution} className={`${btn} border-zinc-700 text-zinc-400`}>Focus Solution</button>
          </Panel>
          <Panel position="bottom-left" className="flex items-center gap-2 bg-[#0b0f0d]/90 border border-zinc-800 rounded-md px-3 py-1.5">
            <span className="text-[11px] text-zinc-500">zoom</span>
            <input type="range" min={0.15} max={1.5} step={0.05} value={zoom}
              onChange={(e) => { const z = +e.target.value; setZoom(z); rf.zoomTo(z, { duration: 120 }); }} className="w-32 accent-emerald-400" />
          </Panel>
          <Panel position="top-right" className="flex gap-3 text-[11px] text-zinc-400 bg-[#0b0f0d]/90 px-3 py-1.5 rounded-md border border-zinc-800">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />correct</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />wrong</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />dead end</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-400/70" />optional</span>
          </Panel>
        </ReactFlow>
      </div>
      <aside className="w-[360px] shrink-0 border-l border-zinc-800 bg-[#0e1310] overflow-y-auto p-4">
        <Detail node={selected} summary={summary} />
      </aside>
    </div>
  );
}

export default function CaseTree({ root, summary }: { root: RawNode; summary?: Record<string, any> }) {
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
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-outline-variant/50 bg-[#0b0f0d] text-emerald-300 py-6 hover:bg-[#0e1310] transition">
        <Maximize2 className="w-4 h-4" /> Open interactive case map
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex p-3 sm:p-6">
          <div className="m-auto w-full h-full max-w-[1500px] bg-[#0b0f0d] rounded-2xl border border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
              <p className="text-sm font-bold text-zinc-200">Case Map — your path vs. the answer key</p>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 min-h-0">
              <ReactFlowProvider><Flow root={root} summary={summary} /></ReactFlowProvider>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
