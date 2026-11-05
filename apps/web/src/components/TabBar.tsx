import * as React from 'react';
import { House, Plus, X } from 'lucide-react';
import type { Route } from '@/lib/router';
import { navigate } from '@/lib/router';
import { cn, isTypingTarget } from '@/lib/utils';
import { useApp } from '@/stores/app';
import { useTabs } from '@/stores/tabs';
import { Tooltip } from '@/components/ui';

const go = (projectId: string | null) => {
  if (!projectId) return navigate.dashboard();
  navigate.project(projectId, useTabs.getState().lastWs[projectId]);
};

/** Barra de abas de projetos, no topo da janela. */
export function TabBar({ route }: { route: Route }) {
  const { open, unseen } = useTabs();
  const projects = useApp((s) => s.projects);
  const procs = useApp((s) => s.procs);
  const current = route.name === 'project' ? route.projectId : null;
  const [dragging, setDragging] = React.useState<string | null>(null);

  React.useEffect(() => {
    useTabs.getState().visit(current, route.name === 'project' ? route.workspaceId : undefined);
  }, [current, route]);

  // Ctrl+Tab / Ctrl+Shift+Tab alternam; Ctrl+1..9 vão direto para a aba.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const ids: (string | null)[] = [null, ...useTabs.getState().open];
      const i = ids.indexOf(current);
      if (e.key === 'Tab') {
        e.preventDefault();
        go(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      } else if (/^[1-9]$/.test(e.key) && !isTypingTarget(e.target)) {
        const target = ids[Number(e.key)];
        if (target !== undefined) {
          e.preventDefault();
          go(target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  const activity = (pid: string) => {
    const list = Object.values(procs).filter((p) => p.projectId === pid && p.status !== 'exited');
    if (list.some((p) => p.agentState === 'waiting')) return 'waiting';
    if (list.some((p) => p.agentState === 'working')) return 'working';
    return list.length ? 'running' : null;
  };

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border bg-background px-1.5 pt-1">
      <Tooltip content="Projetos (Ctrl+1)" side="bottom">
        <button
          onClick={() => go(null)}
          className={cn('mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground', !current && 'bg-accent text-foreground')}
        >
          <House className="size-4" />
        </button>
      </Tooltip>
      {open.map((id, i) => {
        const p = projects.find((x) => x.id === id);
        if (!p) return null;
        const act = activity(id);
        const active = id === current;
        return (
          <div
            key={id}
            draggable
            onDragStart={() => setDragging(id)}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging && dragging !== id) useTabs.getState().move(dragging, id);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                go(useTabs.getState().close(id));
              }
            }}
            onClick={() => !active && go(id)}
            title={`${p.name}${i < 8 ? ` (Ctrl+${i + 2})` : ''}`}
            className={cn(
              'group relative flex h-8 min-w-0 max-w-[200px] shrink-0 cursor-default items-center gap-2 rounded-t-lg border border-b-0 pl-3 pr-1.5 text-[12px] transition-colors',
              active ? 'border-border bg-panel text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              dragging === id && 'opacity-50',
            )}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="truncate">{p.name}</span>
            {act === 'waiting' && <span title="Agente esperando você" className="nexo-pulse size-1.5 shrink-0 rounded-full bg-warning" />}
            {act === 'working' && <span title="Agentes trabalhando" className="nexo-pulse size-1.5 shrink-0 rounded-full bg-claude" />}
            {act === 'running' && <span title="Agentes abertos" className="size-1.5 shrink-0 rounded-full bg-success/70" />}
            {unseen[id] && !active && <span title="Novos agentes criados" className="size-1.5 shrink-0 rounded-full bg-tone-1" />}
            <button
              className="ml-auto rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
              title="Fechar aba (os agentes continuam rodando)"
              onClick={(e) => {
                e.stopPropagation();
                const next = useTabs.getState().close(id);
                if (active) go(next);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <Tooltip content="Abrir outro projeto" side="bottom">
        <button onClick={() => go(null)} className="mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <Plus className="size-4" />
        </button>
      </Tooltip>
    </div>
  );
}
