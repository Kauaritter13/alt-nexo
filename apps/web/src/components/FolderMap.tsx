/**
 * Mapa de uma pasta: o que é agente, o que é cérebro e o que é arquivo.
 * Usado na criação do projeto (prévia) e no painel lateral "Mapa" (adicionar ao canvas).
 */
import * as React from 'react';
import { BRAIN_LABEL, buildScanGraph, type FolderScan, type ScanAgent, type ScanBrain } from '@nexo/shared';
import { useReactFlow } from '@xyflow/react';
import { toast } from 'sonner';
import { Bot, Brain, FileText, FolderTree, Plug, Plus, RefreshCw, Sparkles, SquareTerminal, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, uid } from '@/lib/utils';
import { useApp } from '@/stores/app';
import { useCanvas } from '@/stores/canvas';
import { useAddNode } from '@/canvas/Canvas';
import { Button, EmptyState } from '@/components/ui';
import { Mascot } from './Mascot';

type AddFn = (kind: 'claude' | 'file' | 'terminal', data: Record<string, any>) => void;

/** Lê a pasta (com cancelamento quando o caminho muda). */
export function useFolderScan(path: string | null) {
  const [scan, setScan] = React.useState<FolderScan | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  React.useEffect(() => {
    setScan(null);
    setError(null);
    if (!path) return;
    let alive = true;
    setLoading(true);
    // pequeno atraso: não lê a cada tecla digitada no campo do caminho
    const t = setTimeout(() => {
      api
        .scan(path)
        .then((s) => alive && setScan(s))
        .catch((e) => alive && setError(e.message))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [path, nonce]);
  return { scan, loading, error, reload: () => setNonce((n) => n + 1) };
}

export function ScanSummary({ scan, onAdd, compact }: { scan: FolderScan; onAdd?: AddFn; compact?: boolean }) {
  const f = scan.files;
  const limit = compact ? 4 : 50;
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <Section icon={<Bot className="size-3.5 text-claude" />} title="Agentes" count={scan.agents.length}>
        {scan.agents.length === 0 && <Muted>Nenhum agente em .claude/agents — o canvas começa com um Claude na raiz.</Muted>}
        <Items items={scan.agents} limit={limit} render={(a) => <AgentRow a={a} root={scan.root} />} onAdd={onAdd && ((a) => onAdd('claude', { name: a.name, cwd: a.home, agent: a.name }))} />
        {(scan.skills.length > 0 || scan.commands.length > 0 || scan.mcp.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {scan.skills.length > 0 && <Chip icon={<Sparkles className="size-3" />} label={`${scan.skills.length} skill${scan.skills.length > 1 ? 's' : ''}`} title={scan.skills.map((s) => s.name).join(', ')} />}
            {scan.commands.length > 0 && <Chip icon={<Wand2 className="size-3" />} label={`${scan.commands.length} comando${scan.commands.length > 1 ? 's' : ''}`} title={scan.commands.map((s) => '/' + s.name).join(', ')} />}
            {scan.mcp.length > 0 && <Chip icon={<Plug className="size-3" />} label={`MCP: ${scan.mcp.join(', ')}`} />}
          </div>
        )}
      </Section>

      <Section icon={<Brain className="size-3.5 text-tone-2" />} title="Cérebro" count={scan.brain.length}>
        {scan.brain.length === 0 && <Muted>Sem CLAUDE.md, cofre de notas, memória ou docs.</Muted>}
        <Items items={scan.brain} limit={limit} render={(b) => <BrainRow b={b} />} onAdd={onAdd && ((b) => b.entry && onAdd('file', { path: b.entry }))} />
      </Section>

      <Section icon={<FolderTree className="size-3.5 text-tone-1" />} title="Arquivos" count={f.total} suffix={f.truncated ? '+' : ''}>
        <div className="text-[11.5px] text-muted-foreground">
          {f.dirs.toLocaleString('pt-BR')} pastas{f.git ? ' · Git' : ''}
          {f.byKind.length > 0 && ' · ' + f.byKind.slice(0, 4).map((k) => `${k.count.toLocaleString('pt-BR')} ${k.kind.toLowerCase()}`).join(' · ')}
        </div>
        {f.stack.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {f.stack.map((s) => (
              <span key={s} className="rounded-md border border-border px-1.5 py-0.5 text-[10.5px]">
                {s}
              </span>
            ))}
          </div>
        )}
        {f.subprojects.length > 0 && (
          <div className="mt-2">
            <Items
              items={f.subprojects}
              limit={compact ? 3 : 30}
              render={(s) => (
                <span className="flex min-w-0 items-center gap-1.5">
                  <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{s.name}</span>
                  {s.stack.length > 0 && <span className="truncate text-[10.5px] text-muted-foreground">{s.stack.slice(0, 3).join(', ')}</span>}
                </span>
              )}
              onAdd={onAdd && ((s) => onAdd('terminal', { cwd: s.path, name: s.name.split(/[\\/]/).pop() }))}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function AgentRow({ a, root }: { a: ScanAgent; root: string }) {
  const where = a.home === root ? '' : a.home.slice(root.length).replace(/^[\\/]/, '');
  return (
    <span className="min-w-0" title={a.description || a.path}>
      <span className="block truncate font-medium">{a.name}</span>
      {(a.description || where) && <span className="block truncate text-[10.5px] text-muted-foreground">{where ? `${where} · ` : ''}{a.description}</span>}
    </span>
  );
}

function BrainRow({ b }: { b: ScanBrain }) {
  return (
    <span className="min-w-0" title={b.path}>
      <span className="block truncate">{b.name}</span>
      <span className="block truncate text-[10.5px] text-muted-foreground">
        {BRAIN_LABEL[b.kind]}
        {b.kind !== 'instructions' && ` · ${b.notes} nota${b.notes === 1 ? '' : 's'}`}
      </span>
    </span>
  );
}

function Items<T>({ items, limit, render, onAdd }: { items: T[]; limit: number; render: (it: T) => React.ReactNode; onAdd?: (it: T) => void }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="flex flex-col">
      {shown.map((it, i) => (
        <div key={i} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/60">
          <div className="min-w-0 flex-1">{render(it)}</div>
          {onAdd && (
            <button className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100" title="Adicionar ao canvas" onClick={() => onAdd(it)}>
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {items.length > limit && (
        <button className="self-start px-1 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setAll(!all)}>
          {all ? 'mostrar menos' : `+${items.length - limit} mais`}
        </button>
      )}
    </div>
  );
}

function Section({ icon, title, count, suffix = '', children }: { icon: React.ReactNode; title: string; count: number; suffix?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
        <span className="ml-auto font-mono normal-case tracking-normal text-foreground/80">
          {count.toLocaleString('pt-BR')}
          {suffix}
        </span>
      </div>
      {children}
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <div className="text-[11.5px] text-muted-foreground">{children}</div>;

function Chip({ icon, label, title }: { icon: React.ReactNode; label: string; title?: string }) {
  return (
    <span title={title} className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

/** Estado de leitura com o Nexinho. */
export function ScanStatus({ loading, error, scan }: { loading: boolean; error: string | null; scan: FolderScan | null }) {
  if (error) return <div className="text-[11.5px] text-destructive">{error}</div>;
  if (loading || !scan)
    return (
      <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
        <Mascot mood="working" size={26} />
        Lendo a pasta…
      </div>
    );
  return null;
}

// ───────── Painel lateral ─────────
export function MapPanel({ root }: { root: string | null }) {
  const { scan, loading, error, reload } = useFolderScan(root);
  const addNode = useAddNode();
  const rf = useReactFlow();
  const shell = useApp((s) => s.system?.defaultShell ?? 'powershell.exe');
  const center = () => {
    const el = document.querySelector('.react-flow')!.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: el.left + el.width / 2 - 200, y: el.top + el.height / 2 - 150 });
  };

  if (!root)
    return (
      <EmptyState icon={<FolderTree className="size-5" />} title="Sem diretório">
        Vincule uma pasta ao projeto (menu do projeto → Configurações) para o Nexinho mapear agentes, cérebro e arquivos.
      </EmptyState>
    );

  const buildAll = () => {
    if (!scan) return;
    const top = useCanvas.getState().nodes.filter((n) => !n.parentId);
    const right = top.length ? Math.max(...top.map((n) => n.position.x + (n.width ?? n.measured?.width ?? 300))) + 200 : 0;
    const y = top.length ? Math.min(...top.map((n) => n.position.y)) : 0;
    const g = buildScanGraph(scan, { origin: { x: right, y }, shell, newId: uid });
    useCanvas.getState().insertGraph(g.nodes, g.edges);
    setTimeout(() => rf.fitView({ nodes: g.nodes.filter((n) => !n.parentId).map((n) => ({ id: n.id })), padding: 0.1, duration: 400 }), 60);
    toast.success('Mapa montado no canvas');
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2.5">
        <Mascot mood={loading ? 'working' : scan ? 'happy' : 'idle'} size={30} />
        <div className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted-foreground">{loading ? 'Lendo a pasta…' : 'Passe o mouse num item e clique em + para levá-lo ao canvas.'}</div>
        <Button size="icon-xs" variant="ghost" title="Ler de novo" onClick={reload}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>
      {error && <div className="text-[11.5px] text-destructive">{error}</div>}
      {scan && (
        <>
          <Button size="sm" onClick={buildAll}>
            <FileText /> Montar tudo no canvas
          </Button>
          <ScanSummary scan={scan} onAdd={(kind, data) => addNode(kind, center(), data)} />
        </>
      )}
    </div>
  );
}
