import * as React from 'react';
import { toast } from 'sonner';
import { Minimize2, Workflow } from 'lucide-react';
import { api } from '@/lib/api';
import { useCanvas } from '@/stores/canvas';
import { useUI } from '@/stores/ui';
import { useApp } from '@/stores/app';
import { Button, Dialog, DialogContent, Field, Textarea } from '@/components/ui';
import { TerminalView } from '@/terminal/TerminalView';
import { focusTerminal } from '@/terminal/registry';
import { FileContent, SiteFrame } from '@/canvas/nodes/ContentNodes';
import { EDGE_COLORS } from '@/canvas/edges/FlowEdge';

/** Visão maximizada de terminal/site/arquivo (sem transformação de zoom — seleção de texto precisa). */
export function MaximizedOverlay() {
  const id = useCanvas((s) => s.maximized);
  const node = useCanvas((s) => s.nodes.find((n) => n.id === s.maximized));
  const proc = useApp((s) => (id ? s.procs[id] : undefined));
  React.useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.shiftKey) useCanvas.getState().setMaximized(null);
    };
    window.addEventListener('keydown', onKey);
    if (node?.type === 'claude' || node?.type === 'terminal') setTimeout(() => focusTerminal(id), 50);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, node?.type]);
  if (!id || !node) return null;
  const d = node.data as any;
  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-background/95 p-4 backdrop-blur-sm animate-in fade-in-0 zoom-in-[0.99]">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex h-11 items-center gap-3 border-b border-border px-4">
          <span className="text-[13px] font-medium">{d.name || d.url || d.path || 'Elemento'}</span>
          {proc && <span className="font-mono text-[11px] text-muted-foreground">PID {proc.pid} · {proc.cwd}</span>}
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground">Shift+Esc para restaurar</span>
          <Button size="sm" variant="secondary" onClick={() => useCanvas.getState().setMaximized(null)}>
            <Minimize2 /> Restaurar
          </Button>
        </div>
        <div className="relative min-h-0 flex-1">
          {(node.type === 'claude' || node.type === 'terminal') && <TerminalView nodeId={id} />}
          {node.type === 'site' && d.url && <SiteFrame url={d.url} />}
          {node.type === 'file' && d.path && <FileContent path={d.path} large />}
        </div>
      </div>
    </div>
  );
}

/** Inicia um fluxo a partir de um agente ou tarefa. */
export function RunDialog() {
  const nodeId = useUI((s) => s.runDialogNodeId);
  const close = useUI((s) => s.closeRunDialog);
  const node = useCanvas((s) => s.nodes.find((n) => n.id === nodeId));
  const workspace = useCanvas((s) => s.workspace);
  const edges = useCanvas((s) => s.edges);
  const nodes = useCanvas((s) => s.nodes);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setPrompt(''), [nodeId]);
  if (!node || !workspace) return null;
  const isTask = node.type === 'task';
  const outgoing = edges.filter((e) => e.source === node.id && e.data?.kind !== 'reference');
  const name = (id: string) => {
    const d = nodes.find((n) => n.id === id)?.data as any;
    return d?.name || d?.title || '—';
  };
  const start = async () => {
    setBusy(true);
    try {
      await useCanvas.getState().flush();
      await api.startRun(workspace.id, node.id, prompt);
      useUI.getState().setSidebarTab('runs');
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title={isTask ? 'Executar tarefa' : `Executar fluxo a partir de ${(node.data as any).name}`} description="O prompt é enviado ao(s) agente(s) e as conexões definem o que acontece quando cada um termina.">
        <Field label={isTask ? 'Instruções adicionais (opcional)' : 'Prompt'}>
          <Textarea autoFocus rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && start()} placeholder={isTask ? 'O título e a descrição da tarefa já são enviados.' : 'O que este agente deve fazer?'} />
        </Field>
        {outgoing.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/50 p-3 text-[12px]">
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">Ao concluir</div>
            {outgoing.map((e) => (
              <div key={e.id} className="flex items-center gap-2 py-0.5">
                <span className="size-2 rounded-full" style={{ background: EDGE_COLORS[e.data!.kind] }} />
                <span>{name(e.target)}</span>
                <span className="text-muted-foreground">· {e.data!.kind}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Agentes parados são iniciados automaticamente. Ciclos são bloqueados, cada agente participa uma vez e um agente ocupado só recebe o prompt quando terminar o turno atual.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={start} disabled={busy || (!isTask && !prompt.trim())}>
            <Workflow /> Executar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
