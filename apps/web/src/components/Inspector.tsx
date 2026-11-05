import * as React from 'react';
import { EDGE_KINDS, type ClaudeNodeData, type EdgeKind, type NodeKind, type PermissionMode, type Project, type TaskStatus } from '@nexo/shared';
import { toast } from 'sonner';
import { FolderOpen, History, Play, Send, Share2, Sparkles, Square, Trash2, Workflow, RotateCcw, Eraser } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { useApp } from '@/stores/app';
import { useCanvas, type FlowNode } from '@/stores/canvas';
import { useShallow } from 'zustand/react/shallow';
import { useUI } from '@/stores/ui';
import { Badge, Button, Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui';
import { EDGE_COLORS } from '@/canvas/edges/FlowEdge';
import { PALETTE, ROLE_PRESETS } from '@/canvas/factory';
import { TASK_STATUS, NOTE_COLORS } from '@/canvas/nodes/ContentNodes';
import { useNodeRuntime } from '@/canvas/nodes/shared';
import { clearTerminal } from '@/terminal/registry';
import { usePicker } from './FolderPicker';

export function Inspector({ project }: { project: Project }) {
  const selNodes = useCanvas(useShallow((s) => s.nodes.filter((n) => n.selected)));
  const selEdges = useCanvas(useShallow((s) => s.edges.filter((e) => e.selected)));
  const picker = usePicker();

  let body: React.ReactNode;
  if (selNodes.length === 1 && !selEdges.length) body = <NodeInspector node={selNodes[0]} pick={picker.pick} />;
  else if (selEdges.length === 1 && !selNodes.length) body = <EdgeInspector edgeId={selEdges[0].id} />;
  else if (selNodes.length + selEdges.length > 1)
    body = (
      <div className="p-4 text-[12.5px] text-muted-foreground">
        {selNodes.length} nós e {selEdges.length} conexões selecionados.
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => useCanvas.getState().groupSelection()}>
            Agrupar (Ctrl+G)
          </Button>
          <Button size="sm" variant="secondary" onClick={() => useCanvas.getState().duplicate(selNodes.map((n) => n.id))}>
            Duplicar
          </Button>
          <Button size="sm" variant="destructive" onClick={() => useCanvas.getState().deleteSelection()}>
            Excluir
          </Button>
        </div>
      </div>
    );
  else body = <WorkspaceInspector project={project} />;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {body}
      {picker.element}
    </div>
  );
}

function Header({ kind, title }: { kind: NodeKind; title: string }) {
  const p = PALETTE.find((x) => x.kind === kind)!;
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <p.icon className={cn('size-4', p.color)} />
      <span className="text-[13px] font-semibold">{title}</span>
      <span className="ml-auto text-[11px] text-muted-foreground">{p.label}</span>
    </div>
  );
}

function NodeInspector({ node, pick }: { node: FlowNode; pick: (m: 'folder' | 'file', start?: string) => Promise<string | null> }) {
  const d = node.data as any;
  const set = (patch: Record<string, unknown>) => useCanvas.getState().updateNodeData(node.id, patch);
  const kind = node.type as NodeKind;

  return (
    <>
      <Header kind={kind} title={d.name || d.title || d.label || PALETTE.find((p) => p.kind === kind)!.label} />
      <div className="flex flex-col gap-4 p-4">
        {kind === 'claude' && <ClaudeFields id={node.id} d={d} set={set} pick={pick} />}
        {kind === 'terminal' && (
          <>
            <Field label="Nome">
              <Input value={d.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <CwdField value={d.cwd} onChange={(cwd) => set({ cwd })} pick={pick} />
            <Field label="Shell" hint="Ex.: powershell.exe, pwsh.exe, cmd.exe, bash.exe. Aplicado no próximo início.">
              <Input value={d.shell} onChange={(e) => set({ shell: e.target.value })} className="font-mono text-[12px]" />
            </Field>
            <ProcControls id={node.id} />
          </>
        )}
        {kind === 'task' && <TaskFields id={node.id} d={d} set={set} />}
        {kind === 'note' && (
          <>
            <Field label="Cor">
              <div className="flex gap-2">
                {Object.entries(NOTE_COLORS).map(([k, v]) => (
                  <button key={k} className={cn('size-6 rounded-full ring-2 ring-transparent', d.color === k && 'ring-foreground/60')} style={{ background: v.dot }} onClick={() => set({ color: k })} />
                ))}
              </div>
            </Field>
            <Field label="Texto (Markdown)">
              <Textarea rows={12} value={d.text} onChange={(e) => set({ text: e.target.value })} className="font-mono text-[12px]" />
            </Field>
          </>
        )}
        {kind === 'site' && (
          <Field label="URL" hint="Alguns sites bloqueiam incorporação no navegador (X-Frame-Options/CSP). No app desktop, sites são carregados num webview próprio.">
            <Input value={d.url} onChange={(e) => set({ url: e.target.value })} className="font-mono text-[12px]" />
          </Field>
        )}
        {kind === 'file' && (
          <Field label="Arquivo" hint="A leitura/edição é permitida apenas em pastas autorizadas (diretório do projeto, diretórios dos agentes ou liberadas em Configurações).">
            <div className="flex gap-1.5">
              <Input value={d.path} onChange={(e) => set({ path: e.target.value })} className="font-mono text-[12px]" />
              <Button
                size="icon"
                variant="secondary"
                onClick={async () => {
                  const p = await pick('file', d.path || undefined);
                  if (p) set({ path: p });
                }}
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
        )}
        {kind === 'group' && (
          <>
            <Field label="Nome">
              <Input value={d.label} onChange={(e) => set({ label: e.target.value })} />
            </Field>
            <Field label="Cor">
              <div className="flex gap-2">
                {Object.values(NOTE_COLORS).map((v) => (
                  <button key={v.dot} className={cn('size-6 rounded-full ring-2 ring-transparent', d.color === v.dot && 'ring-foreground/60')} style={{ background: v.dot }} onClick={() => set({ color: v.dot })} />
                ))}
              </div>
            </Field>
          </>
        )}
        <Connections id={node.id} />
      </div>
    </>
  );
}

function CwdField({ value, onChange, pick, hint }: { value: string; onChange: (v: string) => void; pick: (m: 'folder') => Promise<string | null>; hint?: string }) {
  return (
    <Field label="Diretório de trabalho" hint={hint}>
      <div className="flex gap-1.5">
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-[12px]" placeholder="C:\caminho\do\projeto" />
        <Button
          size="icon"
          variant="secondary"
          onClick={async () => {
            const p = await pick('folder');
            if (p) onChange(p);
          }}
        >
          <FolderOpen />
        </Button>
      </div>
    </Field>
  );
}

function ClaudeFields({ id, d, set, pick }: { id: string; d: ClaudeNodeData; set: (p: Record<string, unknown>) => void; pick: (m: 'folder') => Promise<string | null> }) {
  const rt = useNodeRuntime(id);
  const [prompt, setPrompt] = React.useState('');
  const openRun = useUI((s) => s.openRunDialog);
  const canResume = rt.session ? rt.session.resumable : !!d.claudeSessionId;
  const send = async () => {
    if (!prompt.trim()) return;
    try {
      await api.prompt(id, prompt);
      setPrompt('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <Field label="Nome">
        <Input value={d.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <CwdField value={d.cwd} onChange={(cwd) => set({ cwd })} pick={pick} />
      <Field label="Subagente" hint="Nome de um agente em <diretório>/.claude/agents — enviado via --agent. Vazio = Claude padrão.">
        <Input value={d.agent ?? ''} onChange={(e) => set({ agent: e.target.value })} className="font-mono text-[12px]" placeholder="nenhum" />
      </Field>
      <label className="flex items-start gap-2 text-[12.5px]">
        <Switch checked={d.team !== false} onCheckedChange={(team) => set({ team })} />
        <span>
          Pode criar agentes visíveis
          <span className="block text-[11px] text-muted-foreground">Quando dividir o trabalho (front, back…), cada agente novo abre no canvas com terminal próprio. Vale na próxima vez que iniciar.</span>
        </span>
      </label>
      <Field label="Função / instruções do agente" hint="Enviado via --append-system-prompt ao iniciar uma nova sessão (o Claude Code fixa o system prompt da conversa).">
        <div className="mb-1.5 flex flex-wrap gap-1">
          {ROLE_PRESETS.map((p) => (
            <button key={p.name} className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => set({ role: p.role, name: d.name?.startsWith('Claude') ? `Claude — ${p.name}` : d.name })}>
              {p.name}
            </button>
          ))}
        </div>
        <Textarea rows={4} value={d.role} onChange={(e) => set({ role: e.target.value })} placeholder="Ex.: Responsável pela API REST…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Permissões">
          <NativeSelect value={d.permissionMode} onChange={(e) => set({ permissionMode: e.target.value as PermissionMode })}>
            <option value="default">Padrão (pergunta)</option>
            <option value="acceptEdits">Aceitar edições</option>
            <option value="plan">Plano (só leitura)</option>
            <option value="auto">Auto</option>
            <option value="bypassPermissions">Ignorar permissões ⚠</option>
          </NativeSelect>
        </Field>
        <Field label="Modelo">
          <NativeSelect value={d.model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">Padrão da conta</option>
            <option value="opus">Opus</option>
            <option value="sonnet">Sonnet</option>
            <option value="haiku">Haiku</option>
            <option value="fable">Fable</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/50 p-3">
        <div>
          <div className="text-[12.5px] font-medium">Isolar em git worktree</div>
          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">Cria um branch e diretório próprios para este agente, evitando que sobrescreva alterações de outros agentes.</div>
          {d.worktreePath && <div className="mt-1 truncate font-mono text-[10.5px] text-primary">{d.worktreePath}</div>}
        </div>
        <Switch checked={!!d.isolate} onCheckedChange={(v) => set({ isolate: v })} disabled={rt.running} />
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12.5px] font-medium">Sessão</span>
          {rt.proc ? <Badge tone="success">em execução · PID {rt.proc.pid}</Badge> : rt.session ? <Badge>{rt.session.status}</Badge> : <Badge>nunca iniciada</Badge>}
        </div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {(rt.proc?.claudeSessionId ?? d.claudeSessionId) && (
            <div className="truncate">
              ID: <span className="font-mono">{rt.proc?.claudeSessionId ?? d.claudeSessionId}</span>
            </div>
          )}
          {rt.session?.lastActivityAt && <div>Última atividade: {timeAgo(rt.session.lastActivityAt)}</div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {!rt.running ? (
            <>
              <Button size="sm" variant="claude" onClick={rt.start} disabled={rt.busy || !d.cwd}>
                {canResume ? <History /> : <Play />} {canResume ? 'Retomar' : 'Iniciar'}
              </Button>
              {canResume && (
                <Button size="sm" variant="secondary" onClick={rt.startFresh} disabled={rt.busy || !d.cwd}>
                  <Sparkles /> Nova sessão
                </Button>
              )}
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={rt.restart}>
                <RotateCcw /> Reiniciar
              </Button>
              <Button size="sm" variant="secondary" onClick={rt.stop}>
                <Square /> Encerrar
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => openRun(id)}>
            <Workflow /> Fluxo
          </Button>
        </div>
      </div>

      {rt.running && (
        <Field label="Enviar prompt" hint="Enviado ao terminal do agente como se você tivesse digitado. Ctrl+Enter envia.">
          <Textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
            }}
          />
          <Button size="sm" className="self-end" onClick={send} disabled={!prompt.trim()}>
            <Send /> Enviar
          </Button>
        </Field>
      )}
      {rt.session?.lastMessage && (
        <Field label="Última resposta">
          <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-2.5 text-[11.5px] text-muted-foreground">{rt.session.lastMessage}</div>
        </Field>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={async () => {
          await api.clearLog(id);
          clearTerminal(id);
        }}
      >
        <Eraser /> Limpar histórico do terminal
      </Button>
    </>
  );
}

function ProcControls({ id }: { id: string }) {
  const rt = useNodeRuntime(id);
  return (
    <div className="flex gap-1.5">
      {rt.running ? (
        <>
          <Button size="sm" variant="secondary" onClick={rt.restart}>
            <RotateCcw /> Reiniciar
          </Button>
          <Button size="sm" variant="secondary" onClick={rt.stop}>
            <Square /> Encerrar
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={rt.start} disabled={rt.busy}>
          <Play /> Iniciar
        </Button>
      )}
    </div>
  );
}

function TaskFields({ id, d, set }: { id: string; d: any; set: (p: Record<string, unknown>) => void }) {
  const openRun = useUI((s) => s.openRunDialog);
  return (
    <>
      <Field label="Título">
        <Input value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Descrição">
        <Textarea rows={6} value={d.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label="Status">
        <NativeSelect value={d.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
          {Object.entries(TASK_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {d.result && (
        <Field label="Resultado">
          <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background/60 p-2.5 text-[11.5px] text-muted-foreground">{d.result}</div>
        </Field>
      )}
      <Button size="sm" onClick={() => openRun(id)}>
        <Workflow /> Executar com agentes conectados
      </Button>
    </>
  );
}

function Connections({ id }: { id: string }) {
  const edges = useCanvas(useShallow((s) => s.edges.filter((e) => e.source === id || e.target === id)));
  const nodes = useCanvas((s) => s.nodes);
  if (!edges.length) return null;
  const name = (nid: string) => {
    const d = nodes.find((n) => n.id === nid)?.data as any;
    return d?.name || d?.title || d?.label || '—';
  };
  return (
    <Field label={`Conexões (${edges.length})`}>
      <div className="flex flex-col gap-1">
        {edges.map((e) => (
          <button
            key={e.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] hover:bg-accent"
            onClick={() => useCanvas.setState((s) => ({ nodes: s.nodes.map((n) => ({ ...n, selected: false })), edges: s.edges.map((x) => ({ ...x, selected: x.id === e.id })) }))}
          >
            <span className="size-2 rounded-full" style={{ background: EDGE_COLORS[e.data?.kind ?? 'reference'] }} />
            <span className="truncate">
              {e.source === id ? '→ ' : '← '}
              {name(e.source === id ? e.target : e.source)}
            </span>
            <span className="ml-auto text-[10.5px] text-muted-foreground">{EDGE_KINDS.find((k) => k.kind === e.data?.kind)?.label}</span>
          </button>
        ))}
      </div>
    </Field>
  );
}

function EdgeInspector({ edgeId }: { edgeId: string }) {
  const edge = useCanvas((s) => s.edges.find((e) => e.id === edgeId));
  const nodes = useCanvas((s) => s.nodes);
  const workspace = useCanvas((s) => s.workspace);
  if (!edge) return null;
  const src = nodes.find((n) => n.id === edge.source);
  const dst = nodes.find((n) => n.id === edge.target);
  const name = (n?: FlowNode) => (n?.data as any)?.name || (n?.data as any)?.title || (n?.data as any)?.label || n?.type;
  const kind = edge.data?.kind ?? 'reference';
  const canPush = dst?.type === 'claude' && (src?.type === 'claude' || src?.type === 'note' || src?.type === 'task');

  const push = async (submit: boolean) => {
    try {
      await useCanvas.getState().flush();
      await api.pushContext(edge.id, workspace!.id, submit);
      toast.success(submit ? 'Contexto enviado' : 'Contexto colado no terminal do destino');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Share2 className="size-4" style={{ color: EDGE_COLORS[kind] }} />
        <span className="text-[13px] font-semibold">Conexão</span>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-[12px]">
          <span className="truncate font-medium">{name(src)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="truncate font-medium">{name(dst)}</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            title="Inverter direção"
            onClick={() => {
              useCanvas.getState().checkpoint();
              useCanvas.setState((s) => ({ edges: s.edges.map((e) => (e.id === edge.id ? { ...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle } : e)) }));
              useCanvas.getState().markDirty();
            }}
          >
            ⇄
          </Button>
        </div>
        <Field label="Comportamento">
          <div className="flex flex-col gap-1.5">
            {EDGE_KINDS.map((k) => (
              <button
                key={k.kind}
                onClick={() => useCanvas.getState().updateEdge(edge.id, { kind: k.kind as EdgeKind })}
                className={cn('flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors', kind === k.kind ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-accent/50')}
              >
                <svg width="22" height="10" className="mt-1 shrink-0">
                  <line x1="0" y1="5" x2="22" y2="5" style={{ stroke: EDGE_COLORS[k.kind] }} strokeWidth="2" strokeDasharray={k.kind === 'reference' ? '2 4' : '5 3'} />
                </svg>
                <div>
                  <div className="text-[12.5px] font-medium">{k.label}</div>
                  <div className="text-[11px] leading-snug text-muted-foreground">{k.description}</div>
                </div>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Rótulo">
          <Input value={edge.data?.label ?? ''} placeholder="opcional" onChange={(e) => useCanvas.getState().updateEdge(edge.id, { label: e.target.value })} />
        </Field>
        {canPush && (
          <Field label="Compartilhar contexto agora" hint="Envia a última resposta/conteúdo da origem para o agente de destino (que precisa estar em execução).">
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => push(false)}>
                Colar no terminal
              </Button>
              <Button size="sm" onClick={() => push(true)}>
                <Send /> Enviar
              </Button>
            </div>
          </Field>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="self-start text-destructive"
          onClick={() => {
            useCanvas.getState().checkpoint();
            useCanvas.getState().onEdgesChange([{ type: 'remove', id: edge.id }]);
          }}
        >
          <Trash2 /> Remover conexão
        </Button>
      </div>
    </>
  );
}

function WorkspaceInspector({ project }: { project: Project }) {
  const workspace = useCanvas((s) => s.workspace);
  const nodes = useCanvas((s) => s.nodes);
  const procs = useApp((s) => s.procs);
  if (!workspace) return null;
  const settings = workspace.settings;
  const update = async (patch: Partial<typeof settings>) => {
    const w = await api.updateWorkspace(workspace.id, { settings: patch });
    useCanvas.setState({ workspace: w });
  };
  const count = (k: NodeKind) => nodes.filter((n) => n.type === k).length;
  const running = Object.values(procs).filter((p) => p.workspaceId === workspace.id);
  return (
    <>
      <div className="border-b border-border px-4 py-3">
        <div className="text-[13px] font-semibold">{workspace.name}</div>
        <div className="text-[11px] text-muted-foreground">{project.name}</div>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Agentes', count('claude')],
            ['Tarefas', count('task')],
            ['Rodando', running.length],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-border bg-muted/50 p-2.5">
              <div className="text-lg font-semibold">{v}</div>
              <div className="text-[10.5px] text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12.5px]">Encaixar na grade</span>
          <Switch checked={!!settings.snapToGrid} onCheckedChange={(v) => update({ snapToGrid: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12.5px]">Minimapa</span>
          <Switch checked={settings.showMinimap !== false} onCheckedChange={(v) => update({ showMinimap: v })} />
        </div>
        <Field label="Limite de passos por fluxo" hint="Proteção contra execuções descontroladas: cada agente participa uma vez por fluxo e o total de passos é limitado.">
          <Input type="number" min={1} max={100} value={settings.maxRunSteps ?? 12} onChange={(e) => update({ maxRunSteps: Math.max(1, Math.min(100, Number(e.target.value) || 12)) })} />
        </Field>
        {project.rootPath && (
          <Field label="Diretório do projeto">
            <div className="truncate rounded-md bg-background/60 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{project.rootPath}</div>
          </Field>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Selecione um elemento para editar suas propriedades. Conecte nós arrastando a partir das bordas; clique numa conexão para definir seu comportamento.
        </p>
      </div>
    </>
  );
}
