import * as React from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type XYPosition,
} from '@xyflow/react';
import type { NodeKind } from '@nexo/shared';
import { ClipboardPaste, LayoutGrid, Maximize, Plus } from 'lucide-react';
import { useCanvas, type FlowNode } from '@/stores/canvas';
import { useApp } from '@/stores/app';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui';
import { ClaudeNode } from './nodes/ClaudeNode';
import { TerminalNode } from './nodes/TerminalNode';
import { FileNode, GroupNode, NoteNode, SiteNode, TaskNode } from './nodes/ContentNodes';
import { FlowEdge, EDGE_COLORS } from './edges/FlowEdge';
import { PALETTE, defaultData } from './factory';

const nodeTypes: NodeTypes = {
  claude: ClaudeNode,
  terminal: TerminalNode,
  note: NoteNode,
  task: TaskNode,
  site: SiteNode,
  file: FileNode,
  group: GroupNode,
} as NodeTypes;
const edgeTypes: EdgeTypes = { flow: FlowEdge } as EdgeTypes;

export const DND_MIME = 'application/nexo-node';

/** Cria um nó com dados padrão a partir do contexto do projeto. */
export function useAddNode() {
  const rootPath = useCurrentRoot();
  const shell = useApp((s) => s.system?.defaultShell ?? 'powershell.exe');
  return React.useCallback(
    (kind: NodeKind, position: XYPosition, extra?: Record<string, any>) => {
      const agentCount = useCanvas.getState().nodes.filter((n) => n.type === 'claude').length;
      const data = { ...defaultData(kind, { cwd: rootPath ?? '', agentCount, shell }), ...extra };
      return useCanvas.getState().addNode(kind, position, data);
    },
    [rootPath, shell],
  );
}

/**
 * Botão do meio arrasta o canvas em qualquer ponto — inclusive sobre agentes e terminais,
 * que senão ficariam com o clique (o xterm cola texto com o botão do meio).
 */
function useMiddlePan() {
  const rf = useReactFlow();
  const drag = React.useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    document.body.style.cursor = 'grabbing';
  };
  const onPointerMoveCapture = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    const vp = rf.getViewport();
    rf.setViewport({ x: vp.x + e.clientX - d.x, y: vp.y + e.clientY - d.y, zoom: vp.zoom });
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    e.stopPropagation();
    drag.current = null;
    document.body.style.cursor = '';
    useCanvas.getState().setViewport(rf.getViewport());
  };
  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture: end,
    onPointerCancelCapture: end,
    // Sem colar/rolagem automática do navegador no clique do meio.
    onMouseDownCapture: (e: React.MouseEvent) => e.button === 1 && e.preventDefault(),
    onAuxClickCapture: (e: React.MouseEvent) => e.button === 1 && (e.preventDefault(), e.stopPropagation()),
  };
}

export const CurrentRootContext = React.createContext<string | null>(null);
export const useCurrentRoot = () => React.useContext(CurrentRootContext);

export function Canvas() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const workspace = useCanvas((s) => s.workspace);
  const { onNodesChange, onEdgesChange, addEdge, setViewport, reparentOnDrop, paste, autoLayout } = useCanvas.getState();
  const rf = useReactFlow();
  const addNode = useAddNode();
  const menuPos = React.useRef<XYPosition>({ x: 0, y: 0 });
  const middlePan = useMiddlePan();

  const onConnect = React.useCallback((c: Connection) => addEdge(c, 'reference'), [addEdge]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const kind = e.dataTransfer.getData(DND_MIME) as NodeKind;
    if (kind) return void addNode(kind, pos);
    const file = e.dataTransfer.getData('application/nexo-file');
    if (file) {
      const f = JSON.parse(file) as { path: string; dir: boolean };
      if (f.dir) addNode('terminal', pos, { cwd: f.path, name: f.path.split(/[\\/]/).pop() });
      else addNode('file', pos, { path: f.path });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="h-full w-full"
          {...middlePan}
          onContextMenu={(e) => (menuPos.current = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={onDrop}
        >
          <ReactFlow<FlowNode>
            key={workspace?.id}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange as any}
            onConnect={onConnect}
            onNodeDragStop={(_e, node, dragged) => {
              for (const n of dragged.length ? dragged : [node]) reparentOnDrop(n.id);
            }}
            onMoveEnd={(_e, vp) => setViewport(vp)}
            defaultViewport={workspace?.viewport ?? { x: 0, y: 0, zoom: 1 }}
            connectionMode={ConnectionMode.Loose}
            selectionMode={SelectionMode.Partial}
            selectionOnDrag
            panOnDrag={false}
            panOnScroll
            zoomOnScroll={false}
            zoomActivationKeyCode={['Control', 'Meta']}
            minZoom={0.08}
            maxZoom={2.5}
            deleteKeyCode={null}
            multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
            snapToGrid={!!workspace?.settings.snapToGrid}
            snapGrid={[16, 16]}
            onlyRenderVisibleElements={false}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: 'flow' }}
            connectionRadius={28}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="var(--grid)" />
            <Controls showInteractive={false} position="bottom-left" />
            {workspace?.settings.showMinimap !== false && (
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeBorderRadius={6}
                nodeColor={(n) => (n.type === 'claude' ? '#c9f24c' : n.type === 'group' ? 'transparent' : n.type === 'task' ? '#b892f2' : '#6b6a5e')}
                nodeStrokeColor={(n) => (n.type === 'group' ? '#b892f288' : 'transparent')}
                style={{ width: 180, height: 120 }}
              />
            )}
            <EdgeLegend />
          </ReactFlow>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {PALETTE.map((p) => (
          <ContextMenuItem key={p.kind} onSelect={() => addNode(p.kind, menuPos.current)} shortcut={p.key && `Shift+${p.key}`}>
            <p.icon className={p.color} /> {p.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => paste(menuPos.current)} shortcut="Ctrl+V">
          <ClipboardPaste /> Colar aqui
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => autoLayout()} shortcut="Shift+L">
          <LayoutGrid /> Organizar automaticamente
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => rf.fitView({ padding: 0.15, duration: 300 })} shortcut="Shift+1">
          <Maximize /> Enquadrar tudo
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function EdgeLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-14 z-10 hidden items-center gap-3 rounded-lg border border-border bg-panel/80 px-3 py-1.5 text-[10.5px] text-muted-foreground backdrop-blur lg:flex">
      {(
        [
          ['reference', 'Referência'],
          ['context', 'Contexto'],
          ['dependency', 'Dependência'],
          ['sequential', 'Sequencial'],
          ['parallel', 'Paralelo'],
        ] as const
      ).map(([k, l]) => (
        <span key={k} className="flex items-center gap-1.5">
          <svg width="18" height="4">
            <line x1="0" y1="2" x2="18" y2="2" style={{ stroke: EDGE_COLORS[k] }} strokeWidth="2" strokeDasharray={k === 'reference' ? '2 4' : '4 3'} />
          </svg>
          {l}
        </span>
      ))}
    </div>
  );
}

export { Plus };
