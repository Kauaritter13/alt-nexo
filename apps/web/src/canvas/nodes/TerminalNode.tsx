import type { NodeProps } from '@xyflow/react';
import type { TerminalNodeData } from '@nexo/shared';
import { Maximize2, Play, RotateCcw, Square, SquareTerminal } from 'lucide-react';
import { basename } from '@/lib/utils';
import { useCanvas, type FlowNode } from '@/stores/canvas';
import { Button, ContextMenuItem, Spinner, Tooltip } from '@/components/ui';
import { TerminalView } from '@/terminal/TerminalView';
import { NodeHeader, NodeShell, StatusDot, useNodeRuntime, useZoom } from './shared';

export function TerminalNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as TerminalNodeData;
  const rt = useNodeRuntime(id);
  const maximized = useCanvas((s) => s.maximized === id);
  const zoom = useZoom();
  return (
    <NodeShell
      id={id}
      kind="terminal"
      selected={selected}
      menu={
        rt.running ? (
          <>
            <ContextMenuItem onSelect={rt.restart}>
              <RotateCcw /> Reiniciar
            </ContextMenuItem>
            <ContextMenuItem onSelect={rt.stop}>
              <Square /> Encerrar
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onSelect={rt.start}>
            <Play /> Iniciar
          </ContextMenuItem>
        )
      }
    >
      <NodeHeader className="@container">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-tone-1/12 text-tone-1">
          <SquareTerminal className="size-3.5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{d.name || 'Terminal'}</span>
          <span className="truncate text-[10.5px] text-muted-foreground">
            {basename(d.shell || 'shell padrão')} · {basename(d.cwd || '—')}
          </span>
        </div>
        <StatusDot proc={rt.proc ? { ...rt.proc, agentState: 'unknown' } : undefined} />
        <div className="flex items-center gap-0.5 nodrag">
          {rt.busy && <Spinner className="mx-1 text-muted-foreground" />}
          {rt.running ? (
            <Tooltip content="Encerrar">
              <Button size="icon-xs" variant="ghost" onClick={rt.stop}>
                <Square />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content="Iniciar">
              <Button size="icon-xs" variant="ghost" onClick={rt.start} disabled={!d.cwd}>
                <Play />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Maximizar">
            <Button size="icon-xs" variant="ghost" onClick={() => useCanvas.getState().setMaximized(id)}>
              <Maximize2 />
            </Button>
          </Tooltip>
        </div>
      </NodeHeader>
      <div className="relative min-h-0 flex-1">
        {zoom > 0.25 && <TerminalView nodeId={id} active={!maximized} />}
        {!rt.running && !maximized && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-border bg-card/95 px-3 py-2 backdrop-blur nodrag">
            <span className="flex-1 text-[11.5px] text-muted-foreground">{d.cwd ? 'Terminal parado — o histórico anterior fica acima.' : 'Defina o diretório no painel à direita.'}</span>
            <Button size="sm" variant="secondary" onClick={rt.start} disabled={rt.busy || !d.cwd}>
              <Play /> Iniciar
            </Button>
          </div>
        )}
      </div>
    </NodeShell>
  );
}
