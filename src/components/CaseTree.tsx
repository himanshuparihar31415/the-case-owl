import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Panel, Handle, Position,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { Star } from 'lucide-react';

// The post-interview evaluation tree rendered as a proper React-Flow graph:
// horizontal (left→right) auto-layout, status-coloured nodes + branches,
// depth badges, collapse/expand, a "Solution Path" highlight, and a click-to-
// inspect detail panel. Fed the `evaluationTree` root (candidate journey overlaid
// on the MECE answer key); also works on a bare reference tree.

type RawNode = {
  id?: string;
  label?: string;
  depth?: number;
  status?: string;            // reference tree
  reference_status?: string;  // eval tree
  candidate_status?: string;
  quality?: string;
  evaluation_note?: string;
  note?: string;
  candidate_quotes?: string[];
  recommended_path?: string;
  exhibit_shared?: string;
  time_spent?: string;
  was_nudged?: boolean;
  children?: RawNode[];
};

interface NodeData extends Record<string, unknown> {
  label: string;
  depth: number;
  status: string;
  candidateStatus?: string;
  quality?: string;
  star: boolean;
  timeSpent?: string;
  wasNudged?: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  dimmed: boolean;
}

const NODE_W = 184;
const NODE_H = 64;

const refStatus = (n: RawNode): string => n.reference_status ?? n.status ?? 'neutral';

// Border / text styling per reference status.
function statusClasses(status: string): { box: string; text: string } {
  switch (status) {
    case 'correct': return { box: 'border-green-500 bg-green-950/40', text: 'text-green-50' };
    case 'explored_wrong': return { box: 'border-gray-500 bg-transparent', text: 'text-gray-400' };
    case 'dead_end': return { box: 'border-gray-700 bg-transparent', text: 'text-gray-500 line-through' };
    default: return { box: 'border-sky-500/40 bg-transparent', text: 'text-sky-200/70' };
  }
}

function CaseNode({ data }: NodeProps<Node<NodeData>>) {
  const { box, text } = statusClasses(data.status);
  return (
    <div
      className={`relative rounded-xl border px-3 py-2 shadow-sm transition-opacity ${box} ${data.dimmed ? 'opacity-25' : 'opacity-100'}`}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className={`text-[12.5px] font-semibold leading-snug ${text}`}>{data.label}</div>
      {data.timeSpent && <div className="text-[10px] text-gray-500 mt-0.5">{data.timeSpent}</div>}
      {/* depth badge */}
      <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-surface border border-outline-variant/60 text-[10px] font-bold text-secondary flex items-center justify-center">
        {data.depth}
      </span>
      {data.star && <Star className="absolute -top-2 -left-2 w-4 h-4 text-amber-400 fill-amber-400" />}
      {data.wasNudged && <span className="absolute -bottom-2 left-2 text-[9px] uppercase tracking-wide text-amber-500 bg-amber-950/60 px-1 rounded">nudged</span>}
      {data.hasChildren && (
        <span className="absolute -bottom-2 right-2 text-[10px] text-secondary bg-surface border border-outline-variant/60 rounded px-1 leading-tight">
          {data.collapsed ? '+' : '–'}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { caseNode: CaseNode };

function edgeStyleFor(status: string): { stroke: string; dashed: boolean } {
  switch (status) {
    case 'correct': return { stroke: '#22c55e', dashed: false };
    case 'explored_wrong': return { stroke: '#6b7280', dashed: true };
    case 'dead_end': return { stroke: '#4b5563', dashed: true };
    default: return { stroke: '#0ea5e9', dashed: true };
  }
}

// Walk the tree → flat {raw, parentId} list with stable ids.
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

function buildGraph(
  root: RawNode,
  collapsed: Set<string>,
  solutionOnly: boolean,
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const all = flatten(root);
  const byId = new Map(all.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  all.forEach((n) => {
    if (n.parentId) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
  });

  // Hide any node whose ancestor is collapsed.
  const hidden = new Set<string>();
  const hideDescendants = (id: string) => {
    (childrenOf.get(id) ?? []).forEach((c) => { hidden.add(c); hideDescendants(c); });
  };
  collapsed.forEach((id) => hideDescendants(id));

  const visible = all.filter((n) => !hidden.has(n.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 80, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  visible.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  visible.forEach((n) => { if (n.parentId && byId.has(n.parentId) && !hidden.has(n.parentId)) g.setEdge(n.parentId, n.id); });
  dagre.layout(g);

  const nodes: Node<NodeData>[] = visible.map((n) => {
    const pos = g.node(n.id);
    const status = refStatus(n.raw);
    const hasChildren = (childrenOf.get(n.id) ?? []).length > 0;
    const isLeafCorrect = status === 'correct' && !hasChildren && (n.raw.depth ?? 0) >= 6;
    return {
      id: n.id,
      type: 'caseNode',
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: {
        label: n.raw.label ?? '—',
        depth: n.raw.depth ?? 0,
        status,
        candidateStatus: n.raw.candidate_status,
        quality: n.raw.quality,
        star: isLeafCorrect,
        timeSpent: n.raw.time_spent,
        wasNudged: n.raw.was_nudged,
        hasChildren,
        collapsed: collapsed.has(n.id),
        dimmed: solutionOnly && status !== 'correct',
      },
    };
  });

  const edges: Edge[] = visible
    .filter((n) => n.parentId && !hidden.has(n.parentId))
    .map((n) => {
      const status = refStatus(n.raw);
      const { stroke, dashed } = edgeStyleFor(status);
      const dim = solutionOnly && status !== 'correct';
      return {
        id: `${n.parentId}->${n.id}`,
        source: n.parentId as string,
        target: n.id,
        type: 'smoothstep',
        style: { stroke, strokeWidth: status === 'correct' ? 2 : 1.5, strokeDasharray: dashed ? '5 5' : undefined, opacity: dim ? 0.2 : 1 },
      };
    });

  return { nodes, edges };
}

function Inner({ root }: { root: RawNode }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [solutionOnly, setSolutionOnly] = useState(false);
  const [selected, setSelected] = useState<RawNode | null>(null);

  const allIds = useMemo(() => flatten(root), [root]);
  const { nodes, edges } = useMemo(() => buildGraph(root, collapsed, solutionOnly), [root, collapsed, solutionOnly]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const found = allIds.find((n) => n.id === node.id);
    if (found) setSelected(found.raw);
    // toggle collapse of this node's subtree
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }, [allIds]);

  const expandAll = () => setCollapsed(new Set());
  const collapseToSolution = () => {
    // collapse every node that has no correct descendant (keep the spine open)
    const next = new Set<string>();
    allIds.forEach((n) => { if (refStatus(n.raw) !== 'correct') next.add(n.id); });
    setCollapsed(next);
    setSolutionOnly(true);
  };

  return (
    <div className="relative h-[560px] w-full rounded-xl overflow-hidden bg-[#0b0f0d] border border-outline-variant/30">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1f2a25" gap={24} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="flex gap-2">
          <button onClick={() => { setSolutionOnly((s) => !s); }} className={`text-xs px-3 py-1.5 rounded-md border ${solutionOnly ? 'border-green-500 text-green-400' : 'border-outline-variant/50 text-secondary'} bg-surface/80`}>Solution Path</button>
          <button onClick={expandAll} className="text-xs px-3 py-1.5 rounded-md border border-outline-variant/50 text-secondary bg-surface/80">Expand All</button>
          <button onClick={collapseToSolution} className="text-xs px-3 py-1.5 rounded-md border border-outline-variant/50 text-secondary bg-surface/80">Focus Solution</button>
        </Panel>
        <Panel position="top-right" className="flex gap-3 text-[11px] text-gray-400 bg-surface/70 px-3 py-1.5 rounded-md">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />correct</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-500" />wrong turn</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-700" />dead end</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-sky-500/50" />optional</span>
        </Panel>
        {selected && (
          <Panel position="bottom-left" className="max-w-md bg-surface border border-outline-variant/50 rounded-lg p-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold text-sm text-primary">{selected.label}</p>
              <button onClick={() => setSelected(null)} className="text-secondary text-xs">✕</button>
            </div>
            {(selected.evaluation_note ?? selected.note) && <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{selected.evaluation_note ?? selected.note}</p>}
            {Array.isArray(selected.candidate_quotes) && selected.candidate_quotes.map((q, i) => (
              <p key={i} className="text-xs text-secondary italic mt-1 border-l-2 border-outline-variant/40 pl-2">“{q}”</p>
            ))}
            {selected.recommended_path && <p className="text-xs text-green-600 mt-1.5 border border-dashed border-green-500/50 rounded px-2 py-1"><span className="font-bold">Recommended: </span>{selected.recommended_path}</p>}
            {selected.exhibit_shared && <p className="text-[11px] text-secondary mt-1">Exhibits shared: {selected.exhibit_shared}</p>}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export default function CaseTree({ root }: { root: RawNode }) {
  if (!root) return null;
  return (
    <ReactFlowProvider>
      <Inner root={root} />
    </ReactFlowProvider>
  );
}
