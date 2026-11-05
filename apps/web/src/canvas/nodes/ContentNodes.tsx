import * as React from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FileNodeData, GroupNodeData, NoteNodeData, SiteNodeData, TaskNodeData, TaskStatus } from '@nexo/shared';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { CheckCircle2, Circle, CircleDashed, CircleSlash, ExternalLink, FileText, Globe, Loader2, Maximize2, Pencil, Play, RefreshCw, Save, StickyNote, Workflow } from 'lucide-react';
import { api } from '@/lib/api';
import { desktop, isDesktop, openExternal } from '@/lib/desktop';
import { basename, cn } from '@/lib/utils';
import { useCanvas, type FlowNode } from '@/stores/canvas';
import { useShallow } from 'zustand/react/shallow';
import { useApp } from '@/stores/app';
import { useUI } from '@/stores/ui';
import { Button, ContextMenuItem, Input, Tooltip } from '@/components/ui';
import { NodeHeader, NodeShell, useZoom } from './shared';

const md = (text: string) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      a: ({ href, children }) => (
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            if (href) openExternal(href);
          }}
        >
          {children}
        </a>
      ),
    }}
  >
    {text}
  </ReactMarkdown>
);

// ───────── Nota ─────────
/** Cores de nota na paleta ALt. (limão da marca + tons decorativos). Chaves antigas continuam válidas. */
export const NOTE_COLORS: Record<string, { dot: string }> = {
  lime: { dot: 'var(--claude)' },
  blue: { dot: 'var(--tone-1)' },
  violet: { dot: 'var(--tone-2)' },
  green: { dot: 'var(--tone-3)' },
  rose: { dot: 'var(--tone-4)' },
  yellow: { dot: 'var(--warning)' },
  slate: { dot: 'var(--faint)' },
};
export const noteStyle = (dot: string): React.CSSProperties => ({
  background: `color-mix(in oklab, ${dot} 9%, var(--card))`,
  borderColor: `color-mix(in oklab, ${dot} 28%, var(--border))`,
});

export function NoteNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as NoteNodeData;
  const [editing, setEditing] = React.useState(!d.text);
  const c = NOTE_COLORS[d.color] ?? NOTE_COLORS.lime;
  return (
    <NodeShell
      id={id}
      kind="note"
      selected={selected}
      style={noteStyle(c.dot)}
      menu={
        <>
          <ContextMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Editar
          </ContextMenuItem>
          <div className="flex gap-1.5 px-2 py-1.5">
            {Object.entries(NOTE_COLORS).map(([k, v]) => (
              <button key={k} className="size-4 rounded-full ring-1 ring-foreground/15" style={{ background: v.dot }} onClick={() => useCanvas.getState().updateNodeData(id, { color: k })} />
            ))}
          </div>
        </>
      }
    >
      <div className="flex h-7 shrink-0 items-center gap-1.5 px-3 pt-1 text-muted-foreground">
        <StickyNote className="size-3.5" style={{ color: c.dot }} />
        <span className="flex-1 text-[10.5px] uppercase tracking-wider">Nota</span>
        {!editing && (
          <button className="nodrag rounded p-0.5 opacity-0 transition-opacity hover:text-foreground group-hover/node:opacity-100" onClick={() => setEditing(true)}>
            <Pencil className="size-3" />
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="nodrag nowheel flex-1 resize-none bg-transparent px-3 pb-3 font-mono text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
          placeholder="Escreva em Markdown…"
          value={d.text}
          onChange={(e) => useCanvas.getState().updateNodeData(id, { text: e.target.value })}
          onBlur={() => d.text && setEditing(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div className="nexo-md nowheel flex-1 overflow-auto px-3 pb-3 text-[13px]" onDoubleClick={() => setEditing(true)}>
          {md(d.text)}
        </div>
      )}
    </NodeShell>
  );
}

// ───────── Tarefa ─────────
export const TASK_STATUS: Record<TaskStatus, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  todo: { label: 'A fazer', icon: Circle, cls: 'text-muted-foreground' },
  doing: { label: 'Em andamento', icon: CircleDashed, cls: 'text-claude' },
  done: { label: 'Concluída', icon: CheckCircle2, cls: 'text-success' },
  blocked: { label: 'Bloqueada', icon: CircleSlash, cls: 'text-destructive' },
};
const ORDER: TaskStatus[] = ['todo', 'doing', 'done', 'blocked'];

export function TaskNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as TaskNodeData;
  const st = TASK_STATUS[d.status] ?? TASK_STATUS.todo;
  const Icon = st.icon;
  const agents = useCanvas(useShallow((s) => {
    const ids = s.edges.filter((e) => e.source === id || e.target === id).map((e) => (e.source === id ? e.target : e.source));
    return s.nodes.filter((n) => ids.includes(n.id) && n.type === 'claude').map((n) => (n.data as any).name as string);
  }));
  const running = useApp((s) => s.runs.some((r) => r.status === 'running' && r.originNodeId === id));
  const openRun = useUI((s) => s.openRunDialog);
  return (
    <NodeShell
      id={id}
      kind="task"
      selected={selected}
      className={cn(d.status === 'done' && 'opacity-80')}
      menu={
        <ContextMenuItem onSelect={() => openRun(id)} disabled={!agents.length}>
          <Workflow /> Executar tarefa com agentes…
        </ContextMenuItem>
      }
    >
      <div className="flex items-start gap-2 px-3 pt-3">
        <button
          className={cn('nodrag mt-0.5', st.cls)}
          title={`${st.label} — clique para alterar`}
          onClick={() => useCanvas.getState().updateNodeData(id, { status: ORDER[(ORDER.indexOf(d.status) + 1) % ORDER.length] })}
        >
          <Icon className="size-4" />
        </button>
        <input
          className={cn('nodrag min-w-0 flex-1 bg-transparent text-[13.5px] font-medium outline-none placeholder:text-muted-foreground/50', d.status === 'done' && 'line-through decoration-muted-foreground/60')}
          autoFocus={!d.title && !d.description}
          value={d.title}
          placeholder="Título da tarefa"
          onChange={(e) => useCanvas.getState().updateNodeData(id, { title: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <textarea
        className="nodrag nowheel mx-3 mt-1 min-h-0 flex-1 resize-none bg-transparent text-[12px] leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/40"
        placeholder="Descrição, critérios de aceite…"
        value={d.description}
        onChange={(e) => useCanvas.getState().updateNodeData(id, { description: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {d.result && (
        <div className="nowheel mx-3 mb-2 max-h-16 overflow-auto rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground" title={d.result}>
          {d.result.slice(0, 400)}
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3">
        <span className={cn('text-[11px]', st.cls)}>{st.label}</span>
        <span className="flex-1 truncate text-[11px] text-muted-foreground">{agents.length ? `→ ${agents.join(', ')}` : 'sem agente'}</span>
        <Tooltip content={agents.length ? 'Executar com os agentes conectados' : 'Conecte a tarefa a um agente'}>
          <span>
            <Button size="icon-xs" variant="ghost" className="nodrag" disabled={!agents.length || running} onClick={() => openRun(id)}>
              {running ? <Loader2 className="animate-spin" /> : <Play />}
            </Button>
          </span>
        </Tooltip>
      </div>
    </NodeShell>
  );
}

// ───────── Site ─────────
function normalizeUrl(u: string) {
  const t = u.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function SiteNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as SiteNodeData;
  const [draft, setDraft] = React.useState(d.url);
  const [key, setKey] = React.useState(0);
  const maximized = useCanvas((s) => s.maximized === id);
  const zoom = useZoom();
  React.useEffect(() => setDraft(d.url), [d.url]);
  return (
    <NodeShell id={id} kind="site" selected={selected}>
      <NodeHeader>
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-tone-3/12 text-tone-3">
          <Globe className="size-3.5" />
        </div>
        <form
          className="nodrag flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            useCanvas.getState().updateNodeData(id, { url: normalizeUrl(draft) });
            setKey((k) => k + 1);
          }}
        >
          <Input className="h-7 font-mono text-[11.5px]" value={draft} placeholder="https://…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </form>
        <div className="flex items-center gap-0.5 nodrag">
          <Tooltip content="Recarregar">
            <Button size="icon-xs" variant="ghost" onClick={() => setKey((k) => k + 1)}>
              <RefreshCw />
            </Button>
          </Tooltip>
          <Tooltip content="Abrir no navegador">
            <Button size="icon-xs" variant="ghost" onClick={() => d.url && openExternal(d.url)} disabled={!d.url}>
              <ExternalLink />
            </Button>
          </Tooltip>
          <Tooltip content="Maximizar">
            <Button size="icon-xs" variant="ghost" onClick={() => useCanvas.getState().setMaximized(id)}>
              <Maximize2 />
            </Button>
          </Tooltip>
        </div>
      </NodeHeader>
      <div className="relative min-h-0 flex-1 bg-muted/30">
        {d.url && !maximized && zoom > 0.2 ? <SiteFrame key={key} url={d.url} /> : <SitePlaceholder url={d.url} />}
        {/* Sem seleção, uma camada captura o mouse para permitir arrastar/selecionar o nó. */}
        {!selected && d.url && <div className="absolute inset-0" />}
      </div>
    </NodeShell>
  );
}

export function SiteFrame({ url }: { url: string }) {
  if (isDesktop) {
    // No desktop, <webview> carrega o site como página própria (sem restrição de X-Frame-Options).
    return React.createElement('webview', { src: url, className: 'nodrag nowheel h-full w-full', partition: 'persist:nexo-sites', allowpopups: 'true' });
  }
  return (
    <>
      <iframe
        src={url}
        className="nodrag nowheel absolute inset-0 h-full w-full bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        referrerPolicy="no-referrer"
        title={url}
      />
      <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-background/85 px-2 py-1 text-[10px] text-muted-foreground">
        Em branco? O site bloqueia incorporação (X-Frame-Options). Use o app desktop ou abra externamente.
      </div>
    </>
  );
}

function SitePlaceholder({ url }: { url: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <Globe className="size-8 opacity-40" />
      <span className="text-xs">{url ? new URL(url).host : 'Informe uma URL acima'}</span>
    </div>
  );
}

// ───────── Arquivo ─────────
export function FileNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as FileNodeData;
  const zoom = useZoom();
  return (
    <NodeShell id={id} kind="file" selected={selected}>
      <NodeHeader>
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-tone-4/12 text-tone-4">
          <FileText className="size-3.5" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium">{d.path ? basename(d.path) : 'Arquivo'}</span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">{d.path || 'selecione no painel'}</span>
        </div>
        <div className="flex items-center gap-0.5 nodrag">
          {desktop && d.path && (
            <Tooltip content="Abrir no app padrão do sistema">
              <Button size="icon-xs" variant="ghost" onClick={() => desktop!.openPath(d.path)}>
                <ExternalLink />
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Maximizar / editar">
            <Button size="icon-xs" variant="ghost" onClick={() => useCanvas.getState().setMaximized(id)}>
              <Maximize2 />
            </Button>
          </Tooltip>
        </div>
      </NodeHeader>
      <div className="min-h-0 flex-1">{d.path && zoom > 0.3 ? <FileContent path={d.path} /> : null}</div>
    </NodeShell>
  );
}

/** Conteúdo de arquivo com visualização (Markdown renderizado) e edição/salvamento. */
export function FileContent({ path, large }: { path: string; large?: boolean }) {
  const [state, setState] = React.useState<{ loading: boolean; error?: string; content: string; binary?: boolean; truncated?: boolean }>({ loading: true, content: '' });
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const load = React.useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    api
      .fsRead(path)
      .then((r) => setState({ loading: false, content: r.content, binary: r.binary, truncated: r.truncated }))
      .catch((e) => setState({ loading: false, content: '', error: e.message }));
  }, [path]);
  React.useEffect(load, [load]);
  const isMd = /\.(md|markdown|mdx)$/i.test(path);

  if (state.loading) return <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>;
  if (state.error) return <div className="p-3 text-[12px] text-destructive">{state.error}</div>;
  if (state.binary) return <div className="p-3 text-[12px] text-muted-foreground">Arquivo binário — use “Abrir no app padrão”.</div>;

  const save = async () => {
    setSaving(true);
    try {
      await api.fsWrite(path, draft);
      setState((s) => ({ ...s, content: draft }));
      setEditing(false);
      toast.success('Arquivo salvo');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="nodrag absolute right-2 top-2 z-10 flex gap-1 opacity-70 hover:opacity-100">
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} disabled={saving || state.truncated}>
              <Save /> Salvar
            </Button>
          </>
        ) : (
          <>
            <Button size="icon-xs" variant="secondary" onClick={load} title="Recarregar">
              <RefreshCw />
            </Button>
            <Button
              size="icon-xs"
              variant="secondary"
              title={state.truncated ? 'Arquivo grande demais para editar aqui' : 'Editar'}
              disabled={state.truncated}
              onClick={() => {
                setDraft(state.content);
                setEditing(true);
              }}
            >
              <Pencil />
            </Button>
          </>
        )}
      </div>
      {editing ? (
        <textarea
          autoFocus
          className="nodrag nowheel flex-1 resize-none bg-term p-3 font-mono text-[12px] leading-relaxed outline-none"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault();
              void save();
            }
          }}
        />
      ) : isMd ? (
        <div className={cn('nexo-md nowheel nodrag flex-1 overflow-auto p-4 select-text', large && 'mx-auto w-full max-w-3xl text-[14px]')}>{md(state.content)}</div>
      ) : (
        <pre className="nowheel nodrag flex-1 select-text overflow-auto bg-term p-3 font-mono text-[11.5px] leading-relaxed text-[#d9d5c5]">{state.content}</pre>
      )}
      {state.truncated && <div className="border-t border-border px-3 py-1 text-[10.5px] text-warning">Exibindo os primeiros 2 MB.</div>}
    </div>
  );
}

// ───────── Grupo ─────────
export function GroupNode({ id, data, selected }: NodeProps<FlowNode>) {
  const d = data as unknown as GroupNodeData;
  return (
    <NodeShell
      id={id}
      kind="group"
      selected={selected}
      className="border-dashed bg-transparent shadow-none"
      menu={
        <div className="flex gap-1.5 px-2 py-1.5">
          {Object.values(NOTE_COLORS).map((v) => (
            <button key={v.dot} className="size-4 rounded-full ring-1 ring-foreground/15" style={{ background: v.dot }} onClick={() => useCanvas.getState().updateNodeData(id, { color: v.dot })} />
          ))}
        </div>
      }
    >
      <div className="absolute inset-0 rounded-[12px]" style={{ background: `color-mix(in oklab, ${d.color} 5%, transparent)`, border: `1px dashed color-mix(in oklab, ${d.color} 45%, transparent)` }} />
      <div className="relative flex h-9 items-center gap-2 px-3">
        <span className="size-2 rounded-full" style={{ background: d.color }} />
        <input
          className="nodrag min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold tracking-wide outline-none"
          style={{ color: d.color }}
          value={d.label}
          onChange={(e) => useCanvas.getState().updateNodeData(id, { label: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
    </NodeShell>
  );
}
