/**
 * Estado do canvas (React Flow) + histórico (undo/redo) + autosave.
 * O formato persistido (CanvasNode/CanvasEdge) é convertido de/para os tipos do React Flow aqui.
 */
import { create } from 'zustand';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
  type XYPosition,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { DEFAULT_NODE_SIZE, type CanvasEdge, type CanvasNode, type EdgeKind, type NodeKind, type ServerMsg, type Workspace } from '@nexo/shared';
import { api } from '@/lib/api';
import { socket } from '@/lib/ws';
import { uid } from '@/lib/utils';

export type FlowNode = Node<Record<string, any>, NodeKind>;
export type FlowEdge = Edge<{ kind: EdgeKind; label?: string }>;

const HEADER_DRAG = new Set<NodeKind>(['claude', 'terminal', 'site', 'file']);

export function toFlowNode(n: CanvasNode): FlowNode {
  return {
    id: n.id,
    type: n.type,
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    parentId: n.parentId ?? undefined,
    zIndex: n.type === 'group' ? -1 : n.z,
    data: n.data as any,
    dragHandle: HEADER_DRAG.has(n.type) ? '.drag-handle' : undefined,
  };
}

export function fromFlowNode(n: FlowNode): CanvasNode {
  return {
    id: n.id,
    type: n.type as NodeKind,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    width: Math.round(n.width ?? n.measured?.width ?? DEFAULT_NODE_SIZE[n.type as NodeKind].width),
    height: Math.round(n.height ?? n.measured?.height ?? DEFAULT_NODE_SIZE[n.type as NodeKind].height),
    parentId: n.parentId ?? null,
    z: n.type === 'group' ? 0 : (n.zIndex ?? 0),
    data: n.data as any,
  };
}

export const toFlowEdge = (e: CanvasEdge): FlowEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle,
  targetHandle: e.targetHandle,
  type: 'flow',
  data: { kind: e.kind, label: e.label },
});

export const fromFlowEdge = (e: FlowEdge): CanvasEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  sourceHandle: e.sourceHandle ?? null,
  targetHandle: e.targetHandle ?? null,
  kind: e.data?.kind ?? 'reference',
  label: e.data?.label,
});

/** Pais (grupos) precisam vir antes dos filhos no array do React Flow. */
function sortParentsFirst(nodes: FlowNode[]): FlowNode[] {
  const groups = nodes.filter((n) => n.type === 'group');
  const others = nodes.filter((n) => n.type !== 'group');
  return [...groups, ...others];
}

type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[] };
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface CanvasState {
  workspace: Workspace | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  past: Snapshot[];
  future: Snapshot[];
  saveState: SaveState;
  lastSavedAt: number | null;
  maximized: string | null;

  load: (workspaceId: string) => Promise<void>;
  unload: () => Promise<void>;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  setViewport: (v: Viewport) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  addNode: (kind: NodeKind, position: XYPosition, data?: Record<string, any>, size?: { width: number; height: number }) => string;
  /** Insere um conjunto pronto de nós/arestas (ex.: o mapa de uma pasta) num passo de histórico. */
  insertGraph: (nodes: CanvasNode[], edges: CanvasEdge[]) => void;
  updateNodeData: (id: string, patch: Record<string, any>, history?: boolean) => void;
  addEdge: (e: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }, kind?: EdgeKind) => void;
  updateEdge: (id: string, patch: { kind?: EdgeKind; label?: string }) => void;
  deleteSelection: () => void;
  deleteNodes: (ids: string[]) => void;
  duplicate: (ids: string[]) => void;
  copy: () => void;
  paste: (at?: XYPosition) => void;
  groupSelection: () => void;
  ungroup: (groupId: string) => void;
  reparentOnDrop: (nodeId: string) => void;
  autoLayout: () => void;
  selectAll: () => void;
  setMaximized: (id: string | null) => void;
  markDirty: () => void;
  flush: (keepalive?: boolean) => Promise<void>;
}

const CLIPBOARD_KEY = 'nexo.clipboard';
let saveTimer: number | undefined;
let dataTimer: number | undefined;

export const useCanvas = create<CanvasState>((set, get) => ({
  workspace: null,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  past: [],
  future: [],
  saveState: 'idle',
  lastSavedAt: null,
  maximized: null,

  load: async (workspaceId) => {
    await get().flush();
    const g = await api.graph(workspaceId);
    set({
      workspace: g.workspace,
      nodes: sortParentsFirst(g.nodes.map(toFlowNode)),
      edges: g.edges.map(toFlowEdge),
      viewport: g.workspace.viewport,
      past: [],
      future: [],
      saveState: 'saved',
      lastSavedAt: g.workspace.updatedAt,
      maximized: null,
    });
  },

  unload: async () => {
    await get().flush();
    set({ workspace: null, nodes: [], edges: [], past: [], future: [] });
  },

  onNodesChange: (changes) => {
    const s = get();
    let dirty = false;
    let history = false;
    for (const c of changes) {
      if (c.type === 'position' && c.dragging === false) dirty = true;
      if (c.type === 'position' && c.dragging && !history) {
        // início do arrasto: guarda snapshot uma vez
        const n = s.nodes.find((x) => x.id === c.id);
        if (n && !n.dragging) history = true;
      }
      if (c.type === 'dimensions' && (c as any).resizing !== undefined) {
        dirty = true;
        if ((c as any).resizing && !s.nodes.find((x) => x.id === c.id)?.resizing) history = true;
      }
      if (c.type === 'remove') {
        dirty = true;
        history = true;
      }
      if (c.type === 'add' || c.type === 'replace') dirty = true;
    }
    if (history) get().checkpoint();
    set({ nodes: applyNodeChanges(changes, get().nodes) });
    if (dirty) get().markDirty();
  },

  onEdgesChange: (changes) => {
    const dirty = changes.some((c) => c.type !== 'select');
    if (changes.some((c) => c.type === 'remove')) get().checkpoint();
    set({ edges: applyEdgeChanges(changes, get().edges) });
    if (dirty) get().markDirty();
  },

  setViewport: (viewport) => {
    set({ viewport });
    get().markDirty();
  },

  checkpoint: () => {
    const { nodes, edges, past } = get();
    set({ past: [...past.slice(-80), { nodes, edges }], future: [] });
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ nodes: prev.nodes, edges: prev.edges, past: past.slice(0, -1), future: [{ nodes, edges }, ...future] });
    get().markDirty();
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    const next = future[0];
    if (!next) return;
    set({ nodes: next.nodes, edges: next.edges, future: future.slice(1), past: [...past, { nodes, edges }] });
    get().markDirty();
  },

  addNode: (kind, position, data, size) => {
    get().checkpoint();
    const id = uid();
    const sz = size ?? DEFAULT_NODE_SIZE[kind];
    const maxZ = Math.max(0, ...get().nodes.map((n) => n.zIndex ?? 0));
    const node = toFlowNode({ id, type: kind, x: position.x, y: position.y, width: sz.width, height: sz.height, parentId: null, z: maxZ + 1, data: (data ?? {}) as any });
    node.selected = true;
    set({ nodes: sortParentsFirst([...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node]) });
    get().markDirty();
    return id;
  },

  insertGraph: (nodes, edges) => {
    if (!nodes.length) return;
    get().checkpoint();
    set({
      nodes: sortParentsFirst([...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes.map(toFlowNode)]),
      edges: [...get().edges, ...edges.map(toFlowEdge)],
    });
    get().markDirty();
  },

  updateNodeData: (id, patch, history = true) => {
    if (history) {
      // agrupa edições de texto contínuas num único passo de histórico
      if (dataTimer === undefined) get().checkpoint();
      clearTimeout(dataTimer);
      dataTimer = window.setTimeout(() => (dataTimer = undefined), 800);
    }
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) });
    get().markDirty();
  },

  addEdge: (e, kind = 'reference') => {
    if (e.source === e.target) return;
    const exists = get().edges.some((x) => x.source === e.source && x.target === e.target);
    if (exists) return;
    get().checkpoint();
    const edge: FlowEdge = {
      id: uid(),
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      type: 'flow',
      data: { kind },
    };
    set({ edges: [...get().edges, edge] });
    get().markDirty();
  },

  updateEdge: (id, patch) => {
    get().checkpoint();
    set({ edges: get().edges.map((e) => (e.id === id ? { ...e, data: { kind: e.data?.kind ?? 'reference', ...e.data, ...patch } } : e)) });
    get().markDirty();
  },

  deleteSelection: () => {
    const ids = get().nodes.filter((n) => n.selected).map((n) => n.id);
    const edgeIds = new Set(get().edges.filter((e) => e.selected).map((e) => e.id));
    if (!ids.length && !edgeIds.size) return;
    get().checkpoint();
    set({ edges: get().edges.filter((e) => !edgeIds.has(e.id)) });
    get().deleteNodes(ids);
  },

  deleteNodes: (ids) => {
    if (!ids.length) return;
    const set_ = new Set(ids);
    // filhos de grupos removidos também saem
    for (const n of get().nodes) if (n.parentId && set_.has(n.parentId)) set_.add(n.id);
    set({
      nodes: get().nodes.filter((n) => !set_.has(n.id)),
      edges: get().edges.filter((e) => !set_.has(e.source) && !set_.has(e.target)),
      maximized: get().maximized && set_.has(get().maximized!) ? null : get().maximized,
    });
    get().markDirty();
  },

  duplicate: (ids) => {
    get().copy();
    const nodes = get().nodes.filter((n) => ids.includes(n.id));
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    get().paste({ x: minX + 40, y: minY + 40 });
  },

  copy: () => {
    const sel = get().nodes.filter((n) => n.selected);
    if (!sel.length) return;
    const ids = new Set(sel.map((n) => n.id));
    for (const n of get().nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
    const nodes = get().nodes.filter((n) => ids.has(n.id)).map(fromFlowNode);
    const edges = get().edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(fromFlowEdge);
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ nodes, edges }));
  },

  paste: (at) => {
    let clip: { nodes: CanvasNode[]; edges: CanvasEdge[] };
    try {
      clip = JSON.parse(localStorage.getItem(CLIPBOARD_KEY) ?? '');
    } catch {
      return;
    }
    if (!clip?.nodes?.length) return;
    get().checkpoint();
    const map = new Map(clip.nodes.map((n) => [n.id, uid()]));
    const roots = clip.nodes.filter((n) => !n.parentId || !map.has(n.parentId));
    const minX = Math.min(...roots.map((n) => n.x));
    const minY = Math.min(...roots.map((n) => n.y));
    const off = at ? { x: at.x - minX, y: at.y - minY } : { x: 40, y: 40 };
    const nodes = clip.nodes.map((n) => {
      const data: any = { ...n.data };
      if (n.type === 'claude') {
        // a cópia é um agente novo, com conversa própria
        delete data.claudeSessionId;
        delete data.worktreePath;
        data.name = `${data.name ?? 'Claude'} (cópia)`;
      }
      const inGroup = n.parentId && map.has(n.parentId);
      const fn = toFlowNode({
        ...n,
        id: map.get(n.id)!,
        parentId: inGroup ? map.get(n.parentId!)! : null,
        x: inGroup ? n.x : n.x + off.x,
        y: inGroup ? n.y : n.y + off.y,
        data,
      });
      fn.selected = true;
      return fn;
    });
    const edges = clip.edges.map((e) => toFlowEdge({ ...e, id: uid(), source: map.get(e.source)!, target: map.get(e.target)! }));
    set({
      nodes: sortParentsFirst([...get().nodes.map((n) => ({ ...n, selected: false })), ...nodes]),
      edges: [...get().edges, ...edges],
    });
    get().markDirty();
  },

  groupSelection: () => {
    const sel = get().nodes.filter((n) => n.selected && n.type !== 'group' && !n.parentId);
    if (!sel.length) return;
    get().checkpoint();
    const pad = 40;
    const w = (n: FlowNode) => n.width ?? n.measured?.width ?? 200;
    const h = (n: FlowNode) => n.height ?? n.measured?.height ?? 100;
    const minX = Math.min(...sel.map((n) => n.position.x)) - pad;
    const minY = Math.min(...sel.map((n) => n.position.y)) - pad - 24;
    const maxX = Math.max(...sel.map((n) => n.position.x + w(n))) + pad;
    const maxY = Math.max(...sel.map((n) => n.position.y + h(n))) + pad;
    const gid = uid();
    const group = toFlowNode({ id: gid, type: 'group', x: minX, y: minY, width: maxX - minX, height: maxY - minY, parentId: null, z: 0, data: { label: 'Grupo', color: 'var(--tone-2)' } });
    const ids = new Set(sel.map((n) => n.id));
    const nodes = get().nodes.map((n) => (ids.has(n.id) ? { ...n, parentId: gid, position: { x: n.position.x - minX, y: n.position.y - minY }, selected: false } : n));
    set({ nodes: sortParentsFirst([group, ...nodes]) });
    get().markDirty();
  },

  ungroup: (groupId) => {
    const g = get().nodes.find((n) => n.id === groupId);
    if (!g) return;
    get().checkpoint();
    const nodes = get()
      .nodes.filter((n) => n.id !== groupId)
      .map((n) => (n.parentId === groupId ? { ...n, parentId: undefined, position: { x: n.position.x + g.position.x, y: n.position.y + g.position.y } } : n));
    set({ nodes });
    get().markDirty();
  },

  /** Ao soltar um nó: entra no grupo sob ele, ou sai do grupo se foi arrastado para fora. */
  reparentOnDrop: (nodeId) => {
    const nodes = get().nodes;
    const n = nodes.find((x) => x.id === nodeId);
    if (!n || n.type === 'group') return;
    const parent = n.parentId ? nodes.find((x) => x.id === n.parentId) : undefined;
    const abs = parent ? { x: n.position.x + parent.position.x, y: n.position.y + parent.position.y } : n.position;
    const w = n.width ?? n.measured?.width ?? 200;
    const h = n.height ?? n.measured?.height ?? 100;
    const cx = abs.x + w / 2;
    const cy = abs.y + h / 2;
    const target = nodes.find(
      (g) => g.type === 'group' && g.id !== n.id && cx > g.position.x && cx < g.position.x + (g.width ?? 0) && cy > g.position.y && cy < g.position.y + (g.height ?? 0),
    );
    if ((target?.id ?? undefined) === n.parentId) return;
    const pos = target ? { x: abs.x - target.position.x, y: abs.y - target.position.y } : abs;
    set({ nodes: sortParentsFirst(nodes.map((x) => (x.id === nodeId ? { ...x, parentId: target?.id, position: pos } : x))) });
    get().markDirty();
  },

  autoLayout: () => {
    const top = get().nodes.filter((n) => !n.parentId);
    if (top.length < 2) return;
    get().checkpoint();
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of top) g.setNode(n.id, { width: n.width ?? n.measured?.width ?? 300, height: n.height ?? n.measured?.height ?? 200 });
    const topIds = new Set(top.map((n) => n.id));
    for (const e of get().edges) if (topIds.has(e.source) && topIds.has(e.target)) g.setEdge(e.source, e.target);
    dagre.layout(g);
    set({
      nodes: get().nodes.map((n) => {
        if (!topIds.has(n.id)) return n;
        const p = g.node(n.id);
        return { ...n, position: { x: p.x - p.width / 2, y: p.y - p.height / 2 } };
      }),
    });
    get().markDirty();
  },

  selectAll: () => set({ nodes: get().nodes.map((n) => ({ ...n, selected: true })) }),

  setMaximized: (id) => set({ maximized: id }),

  markDirty: () => {
    if (!get().workspace) return;
    set({ saveState: 'dirty' });
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void get().flush(), 700);
  },

  flush: async (keepalive = false) => {
    clearTimeout(saveTimer);
    const { workspace, nodes, edges, viewport, saveState } = get();
    if (!workspace || saveState !== 'dirty') return;
    set({ saveState: 'saving' });
    try {
      const r = await api.saveGraph(workspace.id, { nodes: nodes.map(fromFlowNode), edges: edges.map(fromFlowEdge), viewport }, keepalive);
      if (get().saveState === 'saving') set({ saveState: 'saved' });
      set({ lastSavedAt: r.savedAt });
    } catch {
      set({ saveState: 'error' });
      saveTimer = window.setTimeout(() => {
        if (get().saveState === 'error') {
          set({ saveState: 'dirty' });
          void get().flush();
        }
      }, 3000);
    }
  },
}));

// Atualizações vindas do runtime (status de tarefa, ID de sessão, worktree): aplica sem histórico.
socket.on((m: ServerMsg) => {
  // Agentes criados por outro agente: entram no canvas aberto sem passar pelo histórico (já estão salvos).
  if (m.t === 'graphAdd') {
    const s = useCanvas.getState();
    if (s.workspace?.id !== m.workspaceId) return;
    const have = new Set(s.nodes.map((n) => n.id));
    const nodes = m.nodes.filter((n) => !have.has(n.id)).map(toFlowNode);
    const haveE = new Set(s.edges.map((e) => e.id));
    useCanvas.setState({ nodes: sortParentsFirst([...s.nodes, ...nodes]), edges: [...s.edges, ...m.edges.filter((e) => !haveE.has(e.id)).map(toFlowEdge)] });
    return;
  }
  if (m.t !== 'task') return;
  const s = useCanvas.getState();
  if (s.workspace?.id !== m.workspaceId || !s.nodes.some((n) => n.id === m.nodeId)) return;
  useCanvas.setState({ nodes: s.nodes.map((n) => (n.id === m.nodeId ? { ...n, data: { ...n.data, ...m.patch } } : n)) });
});

// Salva ao fechar/recarregar a janela.
window.addEventListener('beforeunload', () => {
  if (useCanvas.getState().saveState === 'dirty') void useCanvas.getState().flush(true);
});
