import * as React from 'react';
import type { Folder, ProjectSummary } from '@nexo/shared';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  Layers,
  ListTodo,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, download, timeAgo } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { useApp } from '@/stores/app';
import { useUI } from '@/stores/ui';
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  Input,
} from '@/components/ui';
import { ConfirmDialog, EditProjectDialog, NewProjectDialog, PromptDialog, folderOptions } from '@/components/ProjectDialogs';
import { Logo, ProductMark } from '@/components/Logo';
import { Mascot } from '@/components/Mascot';
import { ThemeToggle } from '@/components/ThemeToggle';

type View = { type: 'all' } | { type: 'recent' } | { type: 'archived' } | { type: 'folder'; id: string };

export function Dashboard() {
  const { folders, projects, system, connected } = useApp();
  const [view, setView] = React.useState<View>({ type: 'all' });
  const [q, setQ] = React.useState('');
  const [archived, setArchived] = React.useState<ProjectSummary[]>([]);
  const [newOpen, setNewOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectSummary | null>(null);
  const [promptState, setPromptState] = React.useState<React.ComponentProps<typeof PromptDialog> | null>(null);
  const [confirmState, setConfirmState] = React.useState<React.ComponentProps<typeof ConfirmDialog> | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void useApp.getState().refreshProjects();
  }, []);
  React.useEffect(() => {
    if (view.type === 'archived') api.projects({ archived: true }).then(setArchived);
  }, [view, projects]);

  const descendants = React.useCallback(
    (id: string): Set<string> => {
      const out = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) (out.add(f.id), (changed = true));
      }
      return out;
    },
    [folders],
  );

  const list = React.useMemo(() => {
    let l = view.type === 'archived' ? archived : projects.filter((p) => !p.archived);
    if (view.type === 'folder') {
      const ids = descendants(view.id);
      l = l.filter((p) => p.folderId && ids.has(p.folderId));
    }
    if (view.type === 'recent') l = [...l].filter((p) => p.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)).slice(0, 12);
    if (q.trim()) {
      const s = q.toLowerCase();
      l = l.filter((p) => p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s) || (p.rootPath ?? '').toLowerCase().includes(s));
    }
    return l;
  }, [view, projects, archived, q, descendants]);

  const refresh = () => useApp.getState().refreshProjects();
  const title =
    view.type === 'all' ? 'Todos os projetos' : view.type === 'recent' ? 'Recentes' : view.type === 'archived' ? 'Arquivados' : (folders.find((f) => f.id === view.id)?.name ?? 'Pasta');

  const actions = {
    open: (p: ProjectSummary) => navigate.project(p.id),
    edit: (p: ProjectSummary) => setEditing(p),
    duplicate: async (p: ProjectSummary) => {
      await api.duplicateProject(p.id);
      await refresh();
      toast.success('Projeto duplicado');
    },
    export: async (p: ProjectSummary) => {
      const data = await api.exportProject(p.id);
      download(`${p.name.replace(/[^\w.-]+/g, '_')}.nexo.json`, data);
    },
    archive: async (p: ProjectSummary) => {
      await api.updateProject(p.id, { archived: !p.archived });
      await refresh();
      if (view.type === 'archived') setArchived(await api.projects({ archived: true }));
    },
    move: async (p: ProjectSummary, folderId: string | null) => {
      await api.updateProject(p.id, { folderId });
      await refresh();
    },
    remove: (p: ProjectSummary) =>
      setConfirmState({
        title: `Excluir "${p.name}"?`,
        description: 'Remove canvases, nós e conexões do ALt.nexo. Os arquivos do diretório do projeto NÃO são apagados. Processos em execução serão encerrados.',
        confirm: 'Excluir',
        danger: true,
        onConfirm: async () => {
          await api.deleteProject(p.id);
          await refresh();
          if (view.type === 'archived') setArchived(await api.projects({ archived: true }));
        },
        onClose: () => setConfirmState(null),
      }),
  };

  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      const p = await api.importProject(data);
      await refresh();
      toast.success(`Projeto "${p.name}" importado`);
    } catch (e) {
      toast.error(`Falha ao importar: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Logo className="size-7" />
          <div className="flex-1 leading-tight">
            <ProductMark size={17} />
            <div className="mt-1 text-[10.5px] text-muted-foreground">IDE visual de agentes</div>
          </div>
          <ThemeToggle />
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          <NavItem icon={LayoutGrid} active={view.type === 'all'} onClick={() => setView({ type: 'all' })} count={projects.filter((p) => !p.archived).length}>
            Todos os projetos
          </NavItem>
          <NavItem icon={Clock} active={view.type === 'recent'} onClick={() => setView({ type: 'recent' })}>
            Recentes
          </NavItem>
          <NavItem icon={Archive} active={view.type === 'archived'} onClick={() => setView({ type: 'archived' })}>
            Arquivados
          </NavItem>
        </nav>
        <div className="mt-5 flex items-center justify-between px-4 pb-1">
          <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Pastas</span>
          <Button
            size="icon-xs"
            variant="ghost"
            title="Nova pasta"
            onClick={() =>
              setPromptState({
                title: 'Nova pasta',
                label: 'Nome',
                onSubmit: async (name) => {
                  await api.createFolder(name);
                  await refresh();
                },
                onClose: () => setPromptState(null),
              })
            }
          >
            <FolderPlus />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <FolderTree
            folders={folders}
            parentId={null}
            depth={0}
            projects={projects}
            view={view}
            setView={setView}
            onMoveProject={(pid, fid) => actions.move(projects.find((p) => p.id === pid)!, fid)}
            onPrompt={setPromptState}
            onConfirm={setConfirmState}
            refresh={refresh}
          />
          {!folders.length && <p className="px-2 py-2 text-[11.5px] text-muted-foreground">Crie pastas para organizar seus projetos (ex.: Ideias, Estudos).</p>}
        </div>
        <div className="border-t border-border p-3">
          <button onClick={() => useUI.getState().setSettingsOpen(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-accent">
            <span className={cn('size-2 rounded-full', connected ? 'bg-success' : 'bg-destructive')} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12px]">{system?.claude.loggedIn ? 'Claude Code conectado' : system?.claude.path ? 'Claude Code: faça login' : 'Claude Code não encontrado'}</div>
              <div className="truncate text-[10.5px] text-muted-foreground">
                {system?.claude.version ?? '—'} · {system?.desktop ? 'Desktop' : 'Web'}
              </div>
            </div>
            <Settings className="size-4 text-muted-foreground" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
          <h1 className="text-[15px] font-semibold">{title}</h1>
          <span className="text-[12px] text-muted-foreground">{list.length}</span>
          <div className="relative ml-auto w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar projetos…" className="pl-8" />
          </div>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <Upload /> Importar
          </Button>
          <input ref={fileInput} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0]).finally(() => (e.target.value = ''))} />
          <Button onClick={() => setNewOpen(true)}>
            <Plus /> Novo projeto
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {list.length === 0 ? (
            <EmptyState
              icon={!q && view.type !== 'archived' ? <Mascot mood="idle" size={34} /> : <Layers className="size-5" />}
              title={q ? 'Nada encontrado' : view.type === 'archived' ? 'Nenhum projeto arquivado' : 'Nenhum projeto aqui'}
            >
              {!q && view.type !== 'archived' && (
                <>
                  Escolha uma pasta e o Nexinho mapeia sozinho o que é agente, o que é cérebro e o que é arquivo — e já monta o canvas.
                  <div className="mt-4">
                    <Button onClick={() => setNewOpen(true)}>
                      <Plus /> Novo projeto
                    </Button>
                  </div>
                </>
              )}
            </EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {list.map((p) => (
                <ProjectCard key={p.id} p={p} folders={folders} actions={actions} />
              ))}
            </div>
          )}
        </div>
      </main>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} folderId={view.type === 'folder' ? view.id : null} />
      <EditProjectDialog project={editing} onClose={() => setEditing(null)} />
      {promptState && <PromptDialog {...promptState} />}
      {confirmState && <ConfirmDialog {...confirmState} />}
    </div>
  );
}

function NavItem({ icon: Icon, active, children, onClick, count }: { icon: React.ComponentType<{ className?: string }>; active: boolean; children: React.ReactNode; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors', active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
      <Icon className="size-4" />
      <span className="flex-1 text-left">{children}</span>
      {count !== undefined && <span className="text-[11px] text-muted-foreground">{count}</span>}
    </button>
  );
}

function FolderTree(props: {
  folders: Folder[];
  parentId: string | null;
  depth: number;
  projects: ProjectSummary[];
  view: View;
  setView: (v: View) => void;
  onMoveProject: (projectId: string, folderId: string | null) => void;
  onPrompt: (s: React.ComponentProps<typeof PromptDialog> | null) => void;
  onConfirm: (s: React.ComponentProps<typeof ConfirmDialog> | null) => void;
  refresh: () => Promise<void>;
}) {
  const { folders, parentId, depth, view, setView } = props;
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  const [over, setOver] = React.useState<string | null>(null);
  return (
    <>
      {folders
        .filter((f) => f.parentId === parentId)
        .map((f) => {
          const hasChildren = folders.some((x) => x.parentId === f.id);
          const count = props.projects.filter((p) => p.folderId === f.id && !p.archived).length;
          const active = view.type === 'folder' && view.id === f.id;
          return (
            <div key={f.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => setView({ type: 'folder', id: f.id })}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('application/nexo-project')) {
                        e.preventDefault();
                        setOver(f.id);
                      }
                    }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => {
                      setOver(null);
                      const pid = e.dataTransfer.getData('application/nexo-project');
                      if (pid) props.onMoveProject(pid, f.id);
                    }}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-[13px] transition-colors',
                      active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      over === f.id && 'bg-primary/15 ring-1 ring-primary/50',
                    )}
                    style={{ paddingLeft: 6 + depth * 14 }}
                  >
                    <span
                      className={cn('flex size-4 items-center justify-center', !hasChildren && 'invisible')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }));
                      }}
                    >
                      <ChevronRight className={cn('size-3.5 transition-transform', !collapsed[f.id] && 'rotate-90')} />
                    </span>
                    {active ? <FolderOpen className="size-4 text-warning" /> : <FolderIcon className="size-4 text-warning/70" />}
                    <span className="flex-1 truncate text-left">{f.name}</span>
                    {count > 0 && <span className="text-[11px]">{count}</span>}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() =>
                      props.onPrompt({
                        title: 'Nova subpasta',
                        label: 'Nome',
                        onSubmit: async (name) => {
                          await api.createFolder(name, f.id);
                          await props.refresh();
                        },
                        onClose: () => props.onPrompt(null),
                      })
                    }
                  >
                    <FolderPlus /> Nova subpasta
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() =>
                      props.onPrompt({
                        title: 'Renomear pasta',
                        label: 'Nome',
                        initial: f.name,
                        onSubmit: async (name) => {
                          await api.updateFolder(f.id, { name });
                          await props.refresh();
                        },
                        onClose: () => props.onPrompt(null),
                      })
                    }
                  >
                    <Pencil /> Renomear
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    danger
                    onSelect={() =>
                      props.onConfirm({
                        title: `Excluir pasta "${f.name}"?`,
                        description: 'Subpastas também serão removidas. Os projetos dentro delas voltam para "Sem pasta" — nenhum projeto é excluído.',
                        confirm: 'Excluir pasta',
                        danger: true,
                        onConfirm: async () => {
                          await api.deleteFolder(f.id);
                          if (view.type === 'folder') setView({ type: 'all' });
                          await props.refresh();
                        },
                        onClose: () => props.onConfirm(null),
                      })
                    }
                  >
                    <Trash2 /> Excluir pasta
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {!collapsed[f.id] && <FolderTree {...props} parentId={f.id} depth={depth + 1} />}
            </div>
          );
        })}
    </>
  );
}

type Actions = {
  open: (p: ProjectSummary) => void;
  edit: (p: ProjectSummary) => void;
  duplicate: (p: ProjectSummary) => void;
  export: (p: ProjectSummary) => void;
  archive: (p: ProjectSummary) => void;
  move: (p: ProjectSummary, folderId: string | null) => void;
  remove: (p: ProjectSummary) => void;
};

function ProjectCard({ p, folders, actions }: { p: ProjectSummary; folders: Folder[]; actions: Actions }) {
  const procs = useApp((s) => s.procs);
  const totalTasks = p.tasks.todo + p.tasks.doing + p.tasks.done + p.tasks.blocked;
  const folder = folders.find((f) => f.id === p.folderId);
  const menu = (Item: typeof DropdownMenuItem | typeof ContextMenuItem, Sep: React.ComponentType) => (
    <>
      <Item onSelect={() => actions.open(p)}>
        <FolderOpen /> Abrir
      </Item>
      <Item onSelect={() => actions.edit(p)}>
        <Pencil /> Configurações
      </Item>
      <Item onSelect={() => actions.duplicate(p)}>
        <Copy /> Duplicar
      </Item>
      <Item onSelect={() => actions.export(p)}>
        <Download /> Exportar (.json)
      </Item>
      <Item onSelect={() => actions.archive(p)}>
        {p.archived ? <ArchiveRestore /> : <Archive />} {p.archived ? 'Desarquivar' : 'Arquivar'}
      </Item>
      <Sep />
      <Item danger onSelect={() => actions.remove(p)}>
        <Trash2 /> Excluir
      </Item>
    </>
  );
  void procs;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          draggable
          onDragStart={(e) => e.dataTransfer.setData('application/nexo-project', p.id)}
          onDoubleClick={() => actions.open(p)}
          className="group relative flex cursor-default flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-input hover:shadow-panel"
        >
          <button onClick={() => actions.open(p)} className="relative h-24 overflow-hidden text-left" style={{ background: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${p.color} 28%, transparent), transparent 60%)` }}>
            <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden>
              <defs>
                <pattern id={`dots-${p.id}`} width="14" height="14" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="var(--border)" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#dots-${p.id})`} />
            </svg>
            <MiniGraph color={p.color} seed={p.id} nodes={Math.min(6, Math.max(2, p.nodeCount))} />
          </button>
          <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{p.name}</div>
                <div className="truncate text-[11.5px] text-muted-foreground">{p.description || p.rootPath || 'Workspace de ideias'}</div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menu(DropdownMenuItem, DropdownMenuSeparator)}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderIcon /> Mover para
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onSelect={() => actions.move(p, null)}>Sem pasta</DropdownMenuItem>
                      {folderOptions(folders).map((f) => (
                        <DropdownMenuItem key={f.id} onSelect={() => actions.move(p, f.id)}>
                          <span className="whitespace-pre">{f.label}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {folder && (
                <Badge>
                  <FolderIcon className="size-3" /> {folder.name}
                </Badge>
              )}
              <Badge>
                <Layers className="size-3" /> {p.workspaceCount}
              </Badge>
              {p.agentCount > 0 && (
                <Badge tone="claude">
                  <Bot className="size-3" /> {p.agentCount}
                </Badge>
              )}
              {totalTasks > 0 && (
                <Badge tone="primary">
                  <ListTodo className="size-3" /> {p.tasks.done}/{totalTasks}
                </Badge>
              )}
            </div>
            {totalTasks > 0 && (
              <div className="flex h-1 overflow-hidden rounded-full bg-muted">
                <div className="bg-success" style={{ width: `${(p.tasks.done / totalTasks) * 100}%` }} />
                <div className="bg-claude" style={{ width: `${(p.tasks.doing / totalTasks) * 100}%` }} />
                <div className="bg-destructive" style={{ width: `${(p.tasks.blocked / totalTasks) * 100}%` }} />
              </div>
            )}
            <div className="mt-auto pt-1 text-[11px] text-muted-foreground">Editado {timeAgo(p.updatedAt)}</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>{menu(ContextMenuItem as any, ContextMenuSeparator)}</ContextMenuContent>
    </ContextMenu>
  );
}

/** Ilustração determinística do “grafo” do projeto na capa do card. */
function MiniGraph({ color, seed, nodes }: { color: string; seed: string; nodes: number }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  const pts = Array.from({ length: nodes }, (_, i) => ({ x: 30 + (i / Math.max(1, nodes - 1)) * 220 + rnd() * 20, y: 20 + rnd() * 50 }));
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 96" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {pts.slice(1).map((p, i) => (
        <line key={i} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} stroke={color} strokeOpacity={0.5} strokeWidth={1.2} strokeDasharray="4 4" />
      ))}
      {pts.map((p, i) => (
        <rect key={i} x={p.x - 13} y={p.y - 8} width={26} height={16} rx={4} fill="var(--card)" stroke={color} strokeOpacity={0.7} />
      ))}
    </svg>
  );
}
