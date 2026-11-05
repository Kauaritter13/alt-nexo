import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ClaudeNodeData } from '@nexo/shared';
import { FolderGit2, History, Maximize2, OctagonX, Play, RotateCcw, Sparkles, Square, Workflow } from 'lucide-react';
import { basename, cn, timeAgo } from '@/lib/utils';
import { useCanvas, type FlowNode } from '@/stores/canvas';
import { Badge, Button, ContextMenuItem, ContextMenuSeparator, Spinner, Tooltip } from '@/components/ui';
import { TerminalView } from '@/terminal/TerminalView';
import { NodeHeader, NodeShell, StatusDot, useNodeRuntime, useZoom } from './shared';
import { useUI } from '@/stores/ui';

export function ClaudeNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as ClaudeNodeData;
  const rt = useNodeRuntime(id);
  const maximized = useCanvas((s) => s.maximized === id);
  const zoom = useZoom();
  const openRun = useUI((s) => s.openRunDialog);
  const canResume = rt.session ? rt.session.resumable : !!d.claudeSessionId;

  return (
    <NodeShell
      id={id}
      kind="claude"
      selected={selected}
      className={cn(rt.proc?.agentState === 'working' && 'border-claude/40', rt.proc?.agentState === 'waiting' && 'border-warning/50')}
      menu={
        <>
          {!rt.running && (
            <ContextMenuItem onSelect={rt.start}>
              <Play /> {canResume ? 'Retomar sessão' : 'Iniciar'}
            </ContextMenuItem>
          )}
          {!rt.running && canResume && (
            <ContextMenuItem onSelect={rt.startFresh}>
              <Sparkles /> Nova sessão
            </ContextMenuItem>
          )}
          {rt.running && (
            <>
              <ContextMenuItem onSelect={rt.interrupt}>
                <OctagonX /> Interromper turno (Esc)
              </ContextMenuItem>
              <ContextMenuItem onSelect={rt.restart}>
                <RotateCcw /> Reiniciar (mantém conversa)
              </ContextMenuItem>
              <ContextMenuItem onSelect={rt.stop}>
                <Square /> Encerrar
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openRun(id)}>
            <Workflow /> Executar fluxo a partir daqui…
          </ContextMenuItem>
        </>
      }
    >
      <NodeHeader className="@container">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-claude/15 text-claude">
          <Sparkles className="size-3.5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{d.name || 'Claude'}</span>
          <span className="truncate text-[10.5px] text-muted-foreground">{d.role ? d.role.split('\n')[0] : basename(d.cwd || 'sem diretório')}</span>
        </div>
        <StatusDot proc={rt.proc} />
        <div className="flex items-center gap-0.5 nodrag">
          {rt.busy && <Spinner className="mx-1 text-muted-foreground" />}
          {!rt.running ? (
            <Tooltip content={canResume ? 'Retomar sessão (--resume)' : 'Iniciar Claude Code'}>
              <Button size="icon-xs" variant="ghost" onClick={rt.start} disabled={rt.busy}>
                {canResume ? <History /> : <Play />}
              </Button>
            </Tooltip>
          ) : (
            <>
              <Tooltip content="Interromper turno (Esc)">
                <Button size="icon-xs" variant="ghost" onClick={rt.interrupt}>
                  <OctagonX />
                </Button>
              </Tooltip>
              <Tooltip content="Encerrar processo (a conversa continua retomável)">
                <Button size="icon-xs" variant="ghost" onClick={rt.stop}>
                  <Square />
                </Button>
              </Tooltip>
            </>
          )}
          <Tooltip content="Maximizar">
            <Button size="icon-xs" variant="ghost" onClick={() => useCanvas.getState().setMaximized(id)}>
              <Maximize2 />
            </Button>
          </Tooltip>
        </div>
      </NodeHeader>

      <div className="relative min-h-0 flex-1">
        {zoom > 0.25 ? (
          <TerminalView nodeId={id} active={!maximized} />
        ) : (
          <div className="flex h-full items-center justify-center bg-term text-2xl font-semibold text-muted-foreground">{d.name}</div>
        )}
        {maximized && <div className="absolute inset-0 flex items-center justify-center bg-term text-xs text-muted-foreground">Terminal maximizado</div>}
        {!rt.running && !maximized && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-border bg-card/95 px-3 py-2.5 backdrop-blur nodrag">
            <div className="min-w-0 flex-1 text-[11.5px] text-muted-foreground">
              {!d.cwd ? (
                <span className="text-warning">Defina o diretório de trabalho no painel à direita.</span>
              ) : rt.session ? (
                <>
                  Sessão {rt.session.status === 'interrupted' ? 'interrompida' : 'encerrada'} {timeAgo(rt.session.endedAt)}.{' '}
                  {canResume ? 'A conversa pode ser retomada.' : 'Sem conversa salva.'}
                </>
              ) : (
                <>Pronto para iniciar em {basename(d.cwd)}</>
              )}
            </div>
            {canResume && (
              <Button size="sm" variant="ghost" onClick={rt.startFresh} disabled={rt.busy || !d.cwd}>
                Nova sessão
              </Button>
            )}
            <Button size="sm" variant="claude" onClick={rt.start} disabled={rt.busy || !d.cwd}>
              {canResume ? <History /> : <Play />}
              {canResume ? 'Retomar' : 'Iniciar'}
            </Button>
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border px-2.5 text-[10.5px] text-muted-foreground">
        <span className="truncate font-mono" title={rt.proc?.cwd ?? d.cwd}>
          {rt.proc?.cwd ?? d.cwd ?? '—'}
        </span>
        <span className="flex-1" />
        {d.isolate && (
          <Badge tone="primary">
            <FolderGit2 className="size-3" /> worktree
          </Badge>
        )}
        {d.permissionMode && d.permissionMode !== 'default' && <Badge>{d.permissionMode}</Badge>}
        {d.model && <Badge>{d.model}</Badge>}
        {(rt.proc?.claudeSessionId ?? d.claudeSessionId) && (
          <span className="font-mono opacity-60" title={`Sessão ${rt.proc?.claudeSessionId ?? d.claudeSessionId}`}>
            {(rt.proc?.claudeSessionId ?? d.claudeSessionId)!.slice(0, 8)}
          </span>
        )}
      </div>
    </NodeShell>
  );
}
