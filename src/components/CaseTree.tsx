import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Panel,
  Handle, Position, useReactFlow, MarkerType,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Star, Maximize2, X } from 'lucide-react';

// Post-interview evaluation tree as a React-Flow graph: left→right dagre layout,
// status-coloured node cards + branch edges, depth badges, collapse/expand, a
// "Solution Path" highlight, a fullscreen modal, and click-to-inspect detail.

type RawNode = {
  id?: string; label?: string; depth?: number;
  status?: string; reference_status?: string;
  candidate_status?: string; quality?: string;
  evaluation_note?: string; note?: string;
  candidate_quotes?: string[]; recommended_path?: string;
  exhibit_shared?: string; time_spent?: string; was_nudged?: boolean;
  children?: RawNode[];
};

interface NodeData extends Record<string, unknown> {
  label: string; depth: number; status: string;
  quality?: string; candidateStatus?: string;
  star: boolean; timeSpent?: string; wasNudged?: boolean;
  hasChildren: boolean; collapsed: boolean; dimmed: boolean; selected: boolean;
}

const NODE_W = 210;
const NODE_H = 76;

const refStatus = (n: RawNode): string => n.reference_status ?? n.status ?? 'neutral';

// Per reference-status palette (accent bar + border + text).
function palette(status: string): { accent: string; border: string; text: string; glow: string } {
  switch (status) {
    case 'correct': return { accent: 'bg-emerald-400', border: 'border-emerald-500/70', text: 'text-emerald-50', glow: 'shadow-emerald-500/20' };
    case 'explored_wrong': return { accent: 'bg-zinc-500', border: 'border-zinc-600/70', text: 'text-zinc-300', glow: 'shadow-black/30' };
    case 'dead_end': return { accent: 'bg-zinc-700', border: 'border-zinc-700', text: 'text-zinc-500', glow: 'shadow-black/30' };
    default: return { accent: 'bg-sky-400/70', border: 'border-sky-600/50', text: 'text-sky-100/80', glow: 'shadow-sky-500/10' };
  }
}

// Small fill chip for how well the candidate handled the node.
function qualityChip(q?: string): { label: string; cls: string } | null {
  if (!q || q === 'n/a') return null;
  const map: Record<string, string> = {
    strong: 'bg-emerald-500/20 text-emerald-300',
    adequate: 'bg-lime-500/20 text-lime-300',
    weak: 'bg-amber-500/20 text-amber-300',
    wrong: 'bg-red-500/20 text-red-300',
  };
  return { label: q, cls: map[q] ?? 'bg-zinc-600/30 text-zinc-300' };
}

function CaseNode({ data }: NodeProps<Node<NodeData>>) {
  const p = palette(data.status);
  const chip = qualityChip(data.quality);
  const isDead = data.status === 'dead_end';
  return (
    <div
      className={`group relative flex overflow-hidden rounded-xl border ${p.border} bg-[#131a17] shadow-lg ${p.glow} transition-all
        ${data.dimmed ? 'opacity-25' : 'opacity-100'} ${data.selected ? 'ring-2 ring-emerald-400/80' : ''}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className={`w-1.5 shrink-0 ${p.accent}`} />
      <div className="flex-1 px-3 py-2.5 min-w-0">
        <div className={`text-[13px] font-semibold leading-snug ${p.text} ${isDead ? 'line-through' : ''}`}>{data.label}</div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {chip && <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${chip.cls}`}>{chip.label}</span>}
          {data.timeSpent && <span className="text-[10px] text-zinc-500">{data.timeSpent}</span>}
          {data.wasNudged && <span className="text-[9px] uppercase tracking-wide text-amber-400/80">nudged</span>}
        </div>
      </div>
      <span className="absolute top-1.5 right-2 text-[10px] font-bold text-zinc-500">{data.depth}</span>
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

function edgeColor(status: string): { stroke: string; dashed: boolean; w: number } {
  switch (status) {
    case 'correct': return { stroke: '#34d399', dashed: false, w: 2.5 };
    case 'explored_wrong': return { stroke: '#71717a', dashed: true, w: 1.5 };
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

function buildGraph(root: RawNode, collapsed: Set<string>, solutionOnly: boolean, selectedId: string | null): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const all = flatten(root);
  const byId = new Map(all.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  all.forEach((n) => { if (n.parentId) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]); });

  const hidden = new Set<string>();
  const hideDesc = (id: string) => (childrenOf.get(id) ?? []).forEach((c) => { hidden.add(c); hideDesc(c); });
  collapsed.forEach((id) => hideDesc(id));
  const visible = all.filter((n) => !hidden.has(n.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 96, marginx: 28, marginy: 28 });
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
        quality: n.raw.quality, candidateStatus: n.raw.candidate_status,
        star: status === 'correct' && !hasChildren && (n.raw.depth ?? 0) >= 6,
        timeSpent: n.raw.time_spent, wasNudged: n.raw.was_nudged,
        hasChildren, collapsed: collapsed.has(n.id),
        dimmed: solutionOnly && status !== 'correct',
        selected: selectedId === n.id,
      },
    };
  });

  const edges: Edge[] = visible
    .filter((n) => n.parentId && !hidden.has(n.parentId))
    .map((n) => {
      const status = refStatus(n.raw);
      const { stroke, dashed, w } = edgeColor(status);
      const dim = solutionOnly && status !== 'correct';
      return {
        id: `${n.parentId}->${n.id}`, source: n.parentId as string, target: n.id, type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
        style: { stroke, strokeWidth: w, strokeDasharray: dashed ? '6 5' : undefined, opacity: dim ? 0.18 : 0.9 },
      };
    });

  return { nodes, edges };
}

function Inner({ root, fullscreen, onToggleFullscreen }: { root: RawNode; fullscreen: boolean; onToggleFullscreen: () => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [solutionOnly, setSolutionOnly] = useState(false);
  const [selected, setSelected] = useState<RawNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rf = useReactFlow();

  const allNodes = useMemo(() => flatten(root), [root]);
  const { nodes, edges } = useMemo(() => buildGraph(root, collapsed, solutionOnly, selectedId), [root, collapsed, solutionOnly, selectedId]);

  // Re-fit when the layout or fullscreen changes.
  useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 60); return () => clearTimeout(t); }, [nodes, fullscreen, rf]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const found = allNodes.find((n) => n.id === node.id);
    setSelected(found ? found.raw : null);
    setSelectedId(node.id);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }, [allNodes]);

  const focusSolution = () => {
    const next = new Set<string>();
    allNodes.forEach((n) => { if (refStatus(n.raw) !== 'correct') next.add(n.id); });
    setCollapsed(next); setSolutionOnly(true);
  };

  const btn = 'text-xs px-3 py-1.5 rounded-md border bg-[#0b0f0d]/90 transition';
  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick}
      fitView minZoom={0.15} maxZoom={1.6} proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: 'smoothstep' }}
    >
      <Background variant={BackgroundVariant.Dots} color="#243029" gap={26} size={1.5} />
      <Controls showInteractive={false} className="!shadow-lg" />
      <Panel position="top-left" className="flex flex-wrap gap-2">
        <button onClick={() => setSolutionOnly((s) => !s)} className={`${btn} ${solutionOnly ? 'border-emerald-500 text-emerald-400' : 'border-zinc-700 text-zinc-400'}`}>Solution Path</button>
        <button onClick={() => { setCollapsed(new Set()); setSolutionOnly(false); }} className={`${btn} border-zinc-700 text-zinc-400`}>Expand All</button>
        <button onClick={focusSolution} className={`${btn} border-zinc-700 text-zinc-400`}>Focus Solution</button>
      </Panel>
      <Panel position="top-right" className="flex items-center gap-2">
        <div className="flex gap-3 text-[11px] text-zinc-400 bg-[#0b0f0d]/90 px-3 py-1.5 rounded-md border border-zinc-800">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />correct</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />wrong turn</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />dead end</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-400/70" />optional</span>
        </div>
        <button onClick={onToggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} className="p-2 rounded-md border border-zinc-700 text-zinc-300 bg-[#0b0f0d]/90 hover:text-white">
          {fullscreen ? <X className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </Panel>
      {selected && (
        <Panel position="bottom-left" className="max-w-md bg-[#0b0f0d]/95 border border-zinc-700 rounded-lg p-3.5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <p className="font-bold text-sm text-zinc-100">{selected.label}</p>
            <button onClick={() => { setSelected(null); setSelectedId(null); }} className="text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
          </div>
          {(selected.evaluation_note ?? selected.note) && <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{selected.evaluation_note ?? selected.note}</p>}
          {Array.isArray(selected.candidate_quotes) && selected.candidate_quotes.map((q, i) => (
            <p key={i} className="text-xs text-zinc-500 italic mt-1 border-l-2 border-zinc-700 pl-2">“{q}”</p>
          ))}
          {selected.recommended_path && <p className="text-xs text-emerald-400 mt-1.5 border border-dashed border-emerald-600/60 rounded px-2 py-1">→ {selected.recommended_path}</p>}
          {selected.exhibit_shared && <p className="text-[11px] text-zinc-500 mt-1">Exhibits: {selected.exhibit_shared}</p>}
        </Panel>
      )}
    </ReactFlow>
  );
}

export default function CaseTree({ root }: { root: RawNode }) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  if (!root) return null;

  const container = fullscreen
    ? 'fixed inset-0 z-[80] bg-[#0b0f0d]'
    : 'relative h-[600px] w-full rounded-xl overflow-hidden bg-[#0b0f0d] border border-outline-variant/30';

  return (
    <div className={container}>
      <ReactFlowProvider>
        <Inner root={root} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen((f) => !f)} />
      </ReactFlowProvider>
    </div>
  );
}
