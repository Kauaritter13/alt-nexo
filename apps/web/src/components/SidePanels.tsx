import * as React from 'react';
import type { FsEntry, GitStatus, Run } from '@nexo/shared';
import { useReactFlow } from '@xyflow/react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, CircleCheck, CircleX, File, Folder, GitBranch, GitCommit, Loader2, RefreshCw, Square, Ban, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { desktop } from '@/lib/desktop';
import { cn, timeAgo } from '@/lib/utils';
import { useApp } from '@/stores/app';
import { useCanvas } from '@/stores/canvas';
import { Badge, Button, EmptyState, Kbd } from '@/components/ui';
import { DND_MIME, useAddNode } from '@/canvas/Canvas';
import { PALETTE } from '@/canvas/factory';

// ───────── Elementos ─────────
export function ElementsPanel() {
  const addNode = useAddNode();
  const rf = useReactFlow();
  return (
    <div className="flex flex-col gap-1 p-2">
      <p className="px-2 pb-1 text-[11px] text-muted-foreground">Arraste para o canvas ou clique para adicionar no centro.</p>
      {PALETTE.map((p) => (
        <button
          key={p.kind}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_MIME, p.kind);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => {
            const el = document.querySelector('.react-flow')!.getBoundingClientRect();
            const c = rf.screenToFlowPosition({ x: el.left + el.width / 2 - 150, y: el.top + el.height / 2 - 100 });
            addNode(p.kind, c);
          }}
          className="group flex items-start gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-accent/60"
        >
          <div className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted', p.color)}>
            <p.icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between text-[13px] font-medium">
              {p.label}
              {p.key && (
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                  <Kbd>⇧{p.key}</Kbd>
                </span>
              )}
            </div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">{p.description}</div>
          </div>
        </button>
      ))}
      <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/50 p-3 text-[11px] text-muted-foreground">
        <div className="mb-1 font-medium text-foreground/80">Atalhos</div>
        {[
          ['Selecionar área', 'arrastar'],
          ['Mover canvas', 'Espaço + arrastar / roda'],
          ['Zoom', 'Ctrl + roda'],
          ['Desfazer / refazer', 'Ctrl+Z / Ctrl+Y'],
          ['Copiar / colar / duplicar', 'Ctrl+C / V / D'],
          ['Agrupar', 'Ctrl+G'],
          ['Enquadrar', 'Shift+1'],
          ['Excluir', 'Delete'],
        ].map(([a, b]) => (
          <div key={a} className="flex justify-between gap-2">
            <span>{a}</span>
            <span className="font-mono text-[10.5px]">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────── Arquivos ─────────
export function FilesPanel({ root }: { root: string | null }) {
  if (!root)
    return (
      <EmptyState icon={<Folder className="size-5" />} title="Sem diretório">
        Vincule um diretório ao projeto (menu do projeto → Configurações) para navegar pelos arquivos.
      </EmptyState>
    );
  return (
    <div className="p-1.5 text-[12.5px]">
      <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">Arraste arquivos para criar nós; pastas viram terminais.</p>
      <Tree path={root} depth={0} open />
    </div>
  );
}

function Tree({ path, depth, open: initial = false }: { path: string; depth: number; open?: boolean }) {
  const [open, setOpen] = React.useState(initial);
  const [entries, setEntries] = React.useState<FsEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    api
      .fsList(path)
      .then(setEntries)
      .catch((e) => setError(e.message));
  }, [path]);
  React.useEffect(() => {
    if (open && !entries) load();
  }, [open, entries, load]);
  const name = depth === 0 ? path : path.split(/[\\/]/).pop();
  const addNode = useAddNode();
  const rf = useReactFlow();
  const center = () => {
    const el = document.querySelector('.react-flow')!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: el.left + el.width / 2 - 200, y: el.top + el.height / 2 - 150 });
  };
  return (
    <div>
      <div
        className="flex cursor-default items-center gap-1 rounded-md py-1 pr-2 hover:bg-accent"
        style={{ paddingLeft: depth * 12 + 4 }}
        draggable={depth > 0}
        onDragStart={(e) => e.dataTransfer.setData('application/nexo-file', JSON.stringify({ path, dir: true }))}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        <Folder className="size-3.5 text-warning/80" />
        <span className={cn('truncate', depth === 0 && 'font-mono text-[11px] text-muted-foreground')}>{name}</span>
        {depth === 0 && (
          <button
            className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setEntries(null);
              load();
            }}
          >
            <RefreshCw className="size-3" />
          </button>
        )}
      </div>
      {open && error && <div className="px-6 py-1 text-[11px] text-destructive">{error}</div>}
      {open &&
        entries?.map((e) =>
          e.dir ? (
            <Tree key={e.path} path={e.path} depth={depth + 1} />
          ) : (
            <div
              key={e.path}
              draggable
              onDragStart={(ev) => ev.dataTransfer.setData('application/nexo-file', JSON.stringify({ path: e.path, dir: false }))}
              onDoubleClick={() => addNode('file', center(), { path: e.path })}
              className="flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 hover:bg-accent"
              style={{ paddingLeft: (depth + 1) * 12 + 18 }}
              title={`${e.path}\nDuplo clique: abrir no canvas`}
            >
              <File className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{e.name}</span>
            </div>
          ),
        )}
    </div>
  );
}

// ───────── Git ─────────
export function GitPanel({ root }: { root: string | null }) {
  const [st, setSt] = React.useState<GitStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const nodes = useCanvas((s) => s.nodes);
  const agentDirs = React.useMemo(
    () =>
      nodes
        .filter((n) => n.type === 'claude' && (n.data as any).worktreePath)
        .map((n) => ({ name: (n.data as any).name as string, path: (n.data as any).worktreePath as string })),
    [nodes],
  );
  const load = React.useCallback(() => {
    if (!root) return;
    setLoading(true);
    api
      .gitStatus(root)
      .then(setSt)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [root]);
  React.useEffect(load, [load]);

  if (!root) return <EmptyState icon={<GitBranch className="size-5" />} title="Sem diretório">Vincule um diretório ao projeto para ver o Git.</EmptyState>;
  if (!st) return <div className="flex justify-center p-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>;
  if (!st.isRepo)
    return (
      <EmptyState icon={<GitBranch className="size-5" />} title="Não é um repositório Git">
        <Button
          size="sm"
          className="mt-2"
          onClick={async () => {
            await api.gitInit(root);
            load();
          }}
        >
          git init
        </Button>
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3 p-3 text-[12.5px]">
      <div className="flex items-center gap-2">
        <GitBranch className="size-4 text-primary" />
        <span className="font-mono font-medium">{st.branch}</span>
        {st.ahead > 0 && <Badge tone="primary">↑{st.ahead}</Badge>}
        {st.behind > 0 && <Badge tone="warning">↓{st.behind}</Badge>}
        <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={load}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>
      {st.remote && <div className="truncate font-mono text-[11px] text-muted-foreground">{st.remote}</div>}
      <Section title={`Alterações (${st.changes.length})`}>
        {st.changes.length === 0 && <div className="text-[11.5px] text-muted-foreground">Árvore de trabalho limpa.</div>}
        {st.changes.slice(0, 200).map((c) => (
          <div key={c.path} className="flex items-center gap-2 py-0.5">
            <span className={cn('w-5 font-mono text-[10.5px]', c.code.includes('M') ? 'text-warning' : c.code.includes('D') ? 'text-destructive' : 'text-success')}>{c.code}</span>
            <span className="truncate font-mono text-[11px]">{c.path}</span>
          </div>
        ))}
      </Section>
      {st.worktrees.length > 1 && (
        <Section title="Worktrees">
          {st.worktrees.map((w) => (
            <div key={w.path} className="py-0.5">
              <div className="font-mono text-[11px]">{w.branch ?? '(detached)'}</div>
              <div className="truncate font-mono text-[10.5px] text-muted-foreground">{w.path}</div>
            </div>
          ))}
        </Section>
      )}
      {agentDirs.length > 0 && (
        <Section title="Agentes isolados">
          {agentDirs.map((a) => (
            <div key={a.path} className="flex items-center gap-2 py-0.5">
              <span className="font-medium">{a.name}</span>
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">{a.path}</span>
            </div>
          ))}
        </Section>
      )}
      <Section title="Commits recentes">
        {st.log.map((l) => (
          <div key={l.hash} className="flex items-start gap-2 py-1">
            <GitCommit className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate">{l.subject}</div>
              <div className="text-[10.5px] text-muted-foreground">
                <span className="font-mono">{l.hash}</span> · {l.author} · {l.date}
              </div>
            </div>
          </div>
        ))}
      </Section>
      {desktop && (
        <Button size="sm" variant="secondary" onClick={() => desktop!.openPath(root)}>
          Abrir pasta no Explorer
        </Button>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

// ───────── Execuções ─────────
const STEP_ICON = {
  pending: <Clock className="size-3.5 text-muted-foreground" />,
  running: <Loader2 className="size-3.5 animate-spin text-claude" />,
  done: <CircleCheck className="size-3.5 text-success" />,
  failed: <CircleX className="size-3.5 text-destructive" />,
  skipped: <Ban className="size-3.5 text-muted-foreground" />,
  cancelled: <Ban className="size-3.5 text-muted-foreground" />,
};

export function RunsPanel() {
  const runs = useApp((s) => s.runs);
  const nodes = useCanvas((s) => s.nodes);
  const rf = useReactFlow();
  const label = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return (n?.data as any)?.name || (n?.data as any)?.title || 'nó removido';
  };
  if (!runs.length)
    return (
      <EmptyState icon={<Clock className="size-5" />} title="Nenhuma execução">
        Clique com o botão direito num agente ou tarefa → “Executar fluxo”. As conexões definem a ordem.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-2 p-2">
      {runs.map((r: Run) => (
        <div key={r.id} className="rounded-lg border border-border bg-muted/50 p-2.5">
          <div className="flex items-center gap-2">
            <Badge tone={r.status === 'running' ? 'claude' : r.status === 'done' ? 'success' : r.status === 'failed' ? 'danger' : 'default'}>
              {{ running: 'em execução', done: 'concluída', failed: 'falhou', cancelled: 'cancelada' }[r.status]}
            </Badge>
            <span className="truncate text-[12px] font-medium">{label(r.originNodeId)}</span>
            <span className="ml-auto text-[10.5px] text-muted-foreground">{timeAgo(r.startedAt)}</span>
            {r.status === 'running' && (
              <Button size="icon-xs" variant="ghost" title="Cancelar" onClick={() => api.cancelRun(r.id)}>
                <Square />
              </Button>
            )}
          </div>
          {r.error && <div className="mt-1.5 text-[11px] text-destructive">{r.error}</div>}
          <div className="mt-2 flex flex-col gap-1">
            {r.steps.map((s) => (
              <details key={s.id} className="group rounded-md">
                <summary
                  className="flex cursor-default list-none items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
                  onDoubleClick={() => {
                    const n = nodes.find((x) => x.id === s.nodeId);
                    if (n) rf.fitView({ nodes: [n], duration: 300, maxZoom: 1 });
                  }}
                >
                  {STEP_ICON[s.status]}
                  <span className="truncate text-[12px]">{label(s.nodeId)}</span>
                  <span className="ml-auto truncate text-[10.5px] text-muted-foreground">{s.trigger}</span>
                </summary>
                <div className="ml-6 mt-1 space-y-1.5 pb-1">
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 text-[10.5px] text-muted-foreground">{s.input}</pre>
                  {s.output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 text-[10.5px]">{s.output}</pre>}
                </div>
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
