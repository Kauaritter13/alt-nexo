import * as React from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { NodeKind, Project, Workspace } from '@nexo/shared';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Boxes,
  Check,
  Cloud,
  CloudOff,
  Copy,
  FolderTree,
  GitBranch,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  Redo2,
  Settings,
  Trash2,
  Undo2,
  Workflow,
  LayoutGrid,
  Radar,
} from 'lucide-react';
import { MapPanel } from '@/components/FolderMap';
import { Mascot, type Mood } from '@/components/Mascot';
import { api } from '@/lib/api';
import { cn, isTypingTarget, timeAgo } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { useApp } from '@/stores/app';
import { useCanvas } from '@/stores/canvas';
import { useUI, type SidebarTab } from '@/stores/ui';
import { disposeAllTerminals } from '@/terminal/registry';
import { Canvas, CurrentRootContext, useAddNode } from '@/canvas/Canvas';
import { PALETTE } from '@/canvas/factory';
import { Inspector } from '@/components/Inspector';
import { ElementsPanel, FilesPanel, GitPanel, RunsPanel } from '@/components/SidePanels';
import { MaximizedOverlay, RunDialog } from '@/components/Overlays';
import { ConfirmDialog, EditProjectDialog, PromptDialog } from '@/components/ProjectDialogs';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from '@/components/ui';

export function WorkspaceView({ projectId, workspaceId }: { projectId: string; workspaceId?: string }) {
  const [project, setProject] = React.useState<Project | null>(null);
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const loadedWs = useCanvas((s) => s.workspace?.id);

  const reload = React.useCallback(async () => {
    const [p, ws] = await Promise.all([api.project(projectId), api.workspaces(projectId)]);
    setProject(p);
    setWorkspaces(ws);
    return { p, ws };
  }, [projectId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ws } = await reload();
        void api.openProject(projectId);
        const target = ws.find((w) => w.id === workspaceId) ?? ws[0];
        if (cancelled || !target) return;
        if (target.id !== workspaceId) navigate.replaceProject(projectId, target.id);
        await useCanvas.getState().load(target.id);
        await useApp.getState().loadRuntime(target.id);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, workspaceId, reload]);

  // Ao sair do projeto: salva e libera os terminais da interface (os processos continuam no runtime).
  React.useEffect(
    () => () => {
      void useCanvas.getState().unload();
      disposeAllTerminals();
    },
    [],
  );

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-destructive">{error}</div>
        <Button variant="secondary" onClick={() => navigate.dashboard()}>
          Voltar
        </Button>
      </div>
    );
  if (!project || !loadedWs)
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );

  return (
    <ReactFlowProvider>
      <CurrentRootContext.Provider value={project.rootPath}>
        <Shell project={project} setProject={setProject} workspaces={workspaces} reload={reload} />
      </CurrentRootContext.Provider>
    </ReactFlowProvider>
  );
}

function Shell({ project, setProject, workspaces, reload }: { project: Project; setProject: (p: Project) => void; workspaces: Workspace[]; reload: () => Promise<unknown> }) {
  const workspace = useCanvas((s) => s.workspace)!;
  const { sidebarOpen, sidebarTab, inspectorOpen } = useUI();
  const [editing, setEditing] = React.useState(false);
  const [promptState, setPromptState] = React.useState<React.ComponentProps<typeof PromptDialog> | null>(null);
  const [confirmState, setConfirmState] = React.useState<React.ComponentProps<typeof ConfirmDialog> | null>(null);
  useShortcuts();

  const switchWs = (id: string) => {
    if (id === workspace.id) return;
    disposeAllTerminals();
    navigate.project(project.id, id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-panel px-2">
        <Tooltip content="Projetos">
          <Button size="icon-sm" variant="ghost" onClick={() => navigate.dashboard()}>
            <ArrowLeft />
          </Button>
        </Tooltip>
        <Logo className="size-6" />
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent" onClick={() => setEditing(true)}>
          <span className="size-2.5 rounded-full" style={{ background: project.color }} />
          <span className="text-[13px] font-semibold">{project.name}</span>
        </button>
        <span className="text-muted-foreground/50">/</span>
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {workspaces.map((w) => (
            <WorkspaceTab
              key={w.id}
              w={w}
              active={w.id === workspace.id}
              onClick={() => switchWs(w.id)}
              onRename={() =>
                setPromptState({
                  title: 'Renomear workspace',
                  label: 'Nome',
                  initial: w.name,
                  onSubmit: async (name) => {
                    await api.updateWorkspace(w.id, { name });
                    if (w.id === workspace.id) useCanvas.setState({ workspace: { ...workspace, name } });
                    await reload();
                  },
                  onClose: () => setPromptState(null),
                })
              }
              onDuplicate={async () => {
                await useCanvas.getState().flush();
                const c = await api.duplicateWorkspace(w.id);
                await reload();
                switchWs(c.id);
              }}
              onDelete={() =>
                setConfirmState({
                  title: `Excluir workspace "${w.name}"?`,
                  description: 'Nós e conexões deste canvas serão removidos e seus processos encerrados.',
                  danger: true,
                  confirm: 'Excluir',
                  onConfirm: async () => {
                    try {
                      await api.deleteWorkspace(w.id);
                      const rest = workspaces.filter((x) => x.id !== w.id);
                      await reload();
                      if (w.id === workspace.id && rest[0]) switchWs(rest[0].id);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  },
                  onClose: () => setConfirmState(null),
                })
              }
            />
          ))}
          <Tooltip content="Novo workspace">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() =>
                setPromptState({
                  title: 'Novo workspace',
                  label: 'Nome',
                  initial: 'Novo canvas',
                  onSubmit: async (name) => {
                    const w = await api.createWorkspace(project.id, name);
                    await reload();
                    switchWs(w.id);
                  },
                  onClose: () => setPromptState(null),
                })
              }
            >
              <Plus />
            </Button>
          </Tooltip>
        </div>
        <div className="flex-1" />
        <AgentsSummary />
        <SaveIndicator />
        <HistoryButtons />
        <div className="mx-1 h-5 w-px bg-border" />
        <Tooltip content="Painel lateral">
          <Button size="icon-sm" variant={sidebarOpen ? 'secondary' : 'ghost'} onClick={() => useUI.getState().toggleSidebar()}>
            <PanelLeft />
          </Button>
        </Tooltip>
        <Tooltip content="Propriedades">
          <Button size="icon-sm" variant={inspectorOpen ? 'secondary' : 'ghost'} onClick={() => useUI.getState().toggleInspector()}>
            <PanelRight />
          </Button>
        </Tooltip>
        <ThemeToggle />
        <Tooltip content="Configurações">
          <Button size="icon-sm" variant="ghost" onClick={() => useUI.getState().setSettingsOpen(true)}>
            <Settings />
          </Button>
        </Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Rail + sidebar */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2">
          {(
            [
              ['elements', Boxes, 'Elementos'],
              ['map', Radar, 'Mapa da pasta'],
              ['files', FolderTree, 'Arquivos'],
              ['git', GitBranch, 'Git'],
              ['runs', Workflow, 'Execuções'],
            ] as [SidebarTab, React.ComponentType<{ className?: string }>, string][]
          ).map(([t, Icon, label]) => (
            <Tooltip key={t} content={label} side="right">
              <button
                onClick={() => (sidebarOpen && sidebarTab === t ? useUI.getState().toggleSidebar() : useUI.getState().setSidebarTab(t))}
                className={cn('relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', sidebarOpen && sidebarTab === t && 'bg-accent text-foreground')}
              >
                <Icon className="size-[18px]" />
                {t === 'runs' && <RunningBadge />}
              </button>
            </Tooltip>
          ))}
        </nav>
        {sidebarOpen && (
          <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-panel animate-in slide-in-from-left-2 fade-in-0">
            <div className="sticky top-0 z-10 flex h-10 items-center border-b border-border bg-panel px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {{ elements: 'Elementos', map: 'Mapa da pasta', files: 'Arquivos', git: 'Git', runs: 'Execuções' }[sidebarTab]}
            </div>
            {sidebarTab === 'elements' && <ElementsPanel />}
            {sidebarTab === 'map' && <MapPanel root={project.rootPath} />}
            {sidebarTab === 'files' && <FilesPanel root={project.rootPath} />}
            {sidebarTab === 'git' && <GitPanel root={project.rootPath} />}
            {sidebarTab === 'runs' && <RunsPanel />}
          </aside>
        )}

        <main className="relative min-w-0 flex-1">
          <Canvas />
          <QuickAdd />
          <MaximizedOverlay />
          <EmptyCanvasHint />
        </main>

        {inspectorOpen && (
          <aside className="w-80 shrink-0 border-l border-border bg-panel animate-in slide-in-from-right-2 fade-in-0">
            <Inspector project={project} />
          </aside>
        )}
      </div>

      <RunDialog />
      <EditProjectDialog
        project={editing ? project : null}
        onClose={async () => {
          setEditing(false);
          setProject(await api.project(project.id));
        }}
      />
      {promptState && <PromptDialog {...promptState} />}
      {confirmState && <ConfirmDialog {...confirmState} />}
    </div>
  );
}

function WorkspaceTab({ w, active, onClick, onRename, onDuplicate, onDelete }: { w: Workspace; active: boolean; onClick: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div className={cn('group flex items-center rounded-md', active ? 'bg-accent' : 'hover:bg-accent/60')}>
      <button onClick={onClick} onDoubleClick={onRename} className={cn('whitespace-nowrap px-2.5 py-1 text-[12.5px]', active ? 'text-foreground' : 'text-muted-foreground')}>
        {w.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onRename}>
            <Pencil /> Renomear
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy /> Duplicar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onSelect={onDelete}>
            <Trash2 /> Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function RunningBadge() {
  const n = useApp((s) => s.runs.filter((r) => r.status === 'running').length);
  if (!n) return null;
  return <span className="nexo-pulse absolute right-1.5 top-1.5 size-2 rounded-full bg-claude" />;
}

function AgentsSummary() {
  const wsId = useCanvas((s) => s.workspace?.id);
  const procs = useApp((s) => s.procs);
  const list = Object.values(procs).filter((p) => p.workspaceId === wsId && p.status !== 'exited');
  const working = list.filter((p) => p.agentState === 'working').length;
  const waiting = list.filter((p) => p.agentState === 'waiting').length;
  const mood: Mood = waiting ? 'waiting' : working ? 'working' : list.length ? 'idle' : 'sleep';
  const tip = { waiting: 'Tem agente esperando você', working: 'Agentes trabalhando', idle: 'Agentes abertos, parados', sleep: 'Nenhum agente rodando', happy: '' }[mood];
  if (!list.length) return <Mascot mood="sleep" size={24} title={tip} />;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border py-0.5 pl-1 pr-2 text-[11px] text-muted-foreground">
      <Mascot mood={mood} size={22} title={tip} />
      <span className="flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-success" /> {list.length} ativos
      </span>
      {working > 0 && (
        <span className="flex items-center gap-1 text-claude">
          <span className="nexo-pulse size-1.5 rounded-full bg-claude" /> {working} trabalhando
        </span>
      )}
      {waiting > 0 && (
        <span className="flex items-center gap-1 text-warning">
          <span className="nexo-pulse size-1.5 rounded-full bg-warning" /> {waiting} aguardando você
        </span>
      )}
    </div>
  );
}

function SaveIndicator() {
  const state = useCanvas((s) => s.saveState);
  const at = useCanvas((s) => s.lastSavedAt);
  const connected = useApp((s) => s.connected);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!connected)
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-destructive">
        <CloudOff className="size-3.5" /> Runtime desconectado
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={at ? new Date(at).toLocaleString('pt-BR') : ''}>
      {state === 'saving' || state === 'dirty' ? (
        <>
          <Loader2 className="size-3.5 animate-spin" /> Salvando…
        </>
      ) : state === 'error' ? (
        <span className="flex items-center gap-1.5 text-destructive">
          <CloudOff className="size-3.5" /> Erro ao salvar — tentando de novo
        </span>
      ) : (
        <>
          <Cloud className="size-3.5" /> <Check className="-ml-1 size-3" /> Salvo {at ? timeAgo(at) : ''}
        </>
      )}
    </span>
  );
}

function HistoryButtons() {
  const canUndo = useCanvas((s) => s.past.length > 0);
  const canRedo = useCanvas((s) => s.future.length > 0);
  return (
    <>
      <Tooltip content="Desfazer (Ctrl+Z)">
        <Button size="icon-sm" variant="ghost" disabled={!canUndo} onClick={() => useCanvas.getState().undo()}>
          <Undo2 />
        </Button>
      </Tooltip>
      <Tooltip content="Refazer (Ctrl+Y)">
        <Button size="icon-sm" variant="ghost" disabled={!canRedo} onClick={() => useCanvas.getState().redo()}>
          <Redo2 />
        </Button>
      </Tooltip>
      <Tooltip content="Organizar automaticamente (Shift+L)">
        <Button size="icon-sm" variant="ghost" onClick={() => useCanvas.getState().autoLayout()}>
          <LayoutGrid />
        </Button>
      </Tooltip>
    </>
  );
}

/** Barra flutuante de criação rápida (toolbar contextual do canvas). */
function QuickAdd() {
  const addNode = useAddNode();
  const rf = useReactFlow();
  return (
    <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-panel/90 p-1 shadow-xl backdrop-blur">
      {PALETTE.map((p) => (
        <Tooltip key={p.kind} content={`${p.label}${p.key ? ` (Shift+${p.key})` : ''}`} side="bottom">
          <button
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => {
              const el = document.querySelector('.react-flow')!.getBoundingClientRect();
              addNode(p.kind as NodeKind, rf.screenToFlowPosition({ x: el.left + el.width / 2 - 200, y: el.top + el.height / 2 - 150 }));
            }}
          >
            <p.icon className={cn('size-[18px]', p.color)} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function EmptyCanvasHint() {
  const empty = useCanvas((s) => s.nodes.length === 0);
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <Mascot mood="idle" size={44} className="mb-3" />
        <div className="text-[15px] font-medium">Canvas vazio</div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          Adicione agentes do Claude Code, terminais, tarefas e anotações pela barra acima, pelo clique direito ou arrastando do painel lateral. Tudo é salvo automaticamente.
        </p>
      </div>
    </div>
  );
}

function useShortcuts() {
  const rf = useReactFlow();
  const addNode = useAddNode();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('[role=dialog]')) return;
      const c = useCanvas.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) (e.preventDefault(), c.undo());
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), c.redo());
      else if (mod && k === 'c') c.copy();
      else if (mod && k === 'v') {
        e.preventDefault();
        c.paste();
      } else if (mod && k === 'd') {
        e.preventDefault();
        c.duplicate(c.nodes.filter((n) => n.selected).map((n) => n.id));
      } else if (mod && k === 'a') {
        e.preventDefault();
        c.selectAll();
      } else if (mod && k === 'g') {
        e.preventDefault();
        c.groupSelection();
      } else if (mod && k === 's') {
        e.preventDefault();
        void c.flush();
      } else if (e.key === 'Delete' || e.key === 'Backspace') c.deleteSelection();
      else if (e.shiftKey && e.code === 'Digit1') rf.fitView({ padding: 0.15, duration: 300 });
      else if (e.shiftKey && k === 'l') c.autoLayout();
      else if (e.key === 'Escape') useCanvas.setState({ nodes: c.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), edges: c.edges.map((x) => (x.selected ? { ...x, selected: false } : x)) });
      else if (e.shiftKey && !mod) {
        const p = PALETTE.find((x) => x.key?.toLowerCase() === k);
        if (p) {
          e.preventDefault();
          const el = document.querySelector('.react-flow')!.getBoundingClientRect();
          addNode(p.kind, rf.screenToFlowPosition({ x: el.left + el.width / 2 - 200, y: el.top + el.height / 2 - 150 }));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rf, addNode]);
}
