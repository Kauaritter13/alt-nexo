import * as React from 'react';
import { Handle, NodeResizer, Position, useStore } from '@xyflow/react';
import type { AgentState, NodeKind, ProcInfo, SessionRecord } from '@nexo/shared';
import { toast } from 'sonner';
import { Copy, Group, Maximize2, Trash2, Ungroup } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useApp } from '@/stores/app';
import { useCanvas } from '@/stores/canvas';
import { terminalSize } from '@/terminal/registry';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui';

export const MIN_SIZE: Record<NodeKind, { w: number; h: number }> = {
  claude: { w: 380, h: 240 },
  terminal: { w: 320, h: 200 },
  note: { w: 160, h: 100 },
  task: { w: 220, h: 130 },
  site: { w: 320, h: 220 },
  file: { w: 260, h: 160 },
  group: { w: 200, h: 140 },
};

/** Handles nos quatro lados; com ConnectionMode.Loose qualquer um pode iniciar ou receber conexões. */
export function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />
    </>
  );
}

export function NodeShell({
  id,
  kind,
  selected,
  className,
  children,
  menu,
  accent,
  style,
}: {
  id: string;
  kind: NodeKind;
  selected?: boolean;
  className?: string;
  children: React.ReactNode;
  menu?: React.ReactNode;
  accent?: string;
  style?: React.CSSProperties;
}) {
  const { duplicate, deleteNodes, setMaximized, ungroup, groupSelection } = useCanvas.getState();
  const isChild = useCanvas((s) => !!s.nodes.find((n) => n.id === id)?.parentId);
  const multi = useCanvas((s) => s.nodes.filter((n) => n.selected).length > 1);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'nexo-node group/node relative flex h-full w-full flex-col overflow-hidden rounded-[12px] border border-border bg-card shadow-panel transition-shadow',
            className,
          )}
          style={{ ...(accent ? ({ '--accent-color': accent } as React.CSSProperties) : {}), ...style }}
        >
          <NodeResizer isVisible={!!selected} minWidth={MIN_SIZE[kind].w} minHeight={MIN_SIZE[kind].h} />
          <Handles />
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {menu}
        {menu && <ContextMenuSeparator />}
        {(kind === 'claude' || kind === 'terminal' || kind === 'site' || kind === 'file') && (
          <ContextMenuItem onSelect={() => setMaximized(id)}>
            <Maximize2 /> Maximizar
          </ContextMenuItem>
        )}
        <ContextMenuItem shortcut="Ctrl+D" onSelect={() => duplicate([id])}>
          <Copy /> Duplicar
        </ContextMenuItem>
        {multi && !isChild && (
          <ContextMenuItem shortcut="Ctrl+G" onSelect={() => groupSelection()}>
            <Group /> Agrupar seleção
          </ContextMenuItem>
        )}
        {kind === 'group' && (
          <ContextMenuItem onSelect={() => ungroup(id)}>
            <Ungroup /> Desagrupar
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          danger
          shortcut="Del"
          onSelect={() => {
            useCanvas.getState().checkpoint();
            deleteNodes([id]);
          }}
        >
          <Trash2 /> Excluir
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function NodeHeader({ children, className, drag = true }: { children: React.ReactNode; className?: string; drag?: boolean }) {
  return (
    <div className={cn('flex h-10 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-2.5', drag && 'drag-handle cursor-grab active:cursor-grabbing', className)}>
      {children}
    </div>
  );
}

const STATE_META: Record<AgentState | 'stopped' | 'starting', { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Aguardando prompt', color: 'bg-success' },
  working: { label: 'Trabalhando', color: 'bg-claude', pulse: true },
  waiting: { label: 'Precisa de você', color: 'bg-warning', pulse: true },
  unknown: { label: 'Em execução', color: 'bg-tone-1' },
  stopped: { label: 'Parado', color: 'bg-faint' },
  starting: { label: 'Iniciando', color: 'bg-tone-1', pulse: true },
};

export function StatusDot({ proc, className }: { proc: ProcInfo | undefined; className?: string }) {
  const key = !proc ? 'stopped' : proc.status === 'starting' ? 'starting' : proc.agentState;
  const m = STATE_META[key];
  return (
    <span className={cn('flex items-center gap-1.5 text-[11px] text-muted-foreground', className)} title={m.label}>
      <span className={cn('size-2 rounded-full', m.color, m.pulse && 'nexo-pulse')} />
      <span className="hidden @[380px]:inline">{m.label}</span>
    </span>
  );
}

/** Estado de execução e ações de um nó com processo (Claude ou terminal). */
export function useNodeRuntime(nodeId: string) {
  const proc = useApp((s) => s.procs[nodeId]) as ProcInfo | undefined;
  const session = useApp((s) => s.sessions[nodeId]) as SessionRecord | undefined;
  const [busy, setBusy] = React.useState(false);

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      // O nó precisa estar persistido antes de o runtime iniciar o processo.
      await useCanvas.getState().flush();
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    proc,
    session,
    busy,
    running: !!proc,
    start: wrap(() => api.start(nodeId, { ...terminalSize(nodeId) })),
    startFresh: wrap(() => api.start(nodeId, { fresh: true, ...terminalSize(nodeId) })),
    stop: wrap(() => api.stop(nodeId)),
    restart: wrap(() => api.restart(nodeId)),
    restartFresh: wrap(() => api.restart(nodeId, true)),
    interrupt: wrap(() => api.interrupt(nodeId)),
  };
}

/** Zoom atual do canvas (para simplificar a renderização quando muito afastado). */
export function useZoom() {
  return useStore((s) => s.transform[2]);
}
