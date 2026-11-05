/**
 * Orquestrador de fluxos entre agentes.
 *
 * Regras de segurança:
 *  - Nada executa sozinho: toda execução começa por uma ação explícita do usuário ("Executar fluxo").
 *  - Ciclos em arestas executáveis (sequencial/dependência/paralelo) são rejeitados antes de iniciar.
 *  - Cada agente participa no máximo uma vez por execução, e há um limite de passos (maxRunSteps).
 *  - Um agente ocupado (working/waiting) não recebe prompt — o passo aguarda ele ficar livre.
 */
import { EventEmitter } from 'node:events';
import type { CanvasEdge, CanvasNode, ClaudeNodeData, Run, RunStep, TaskNodeData } from '@nexo/shared';
import type { ProcessManager } from './processes.js';
import { badRequest, newId, type Repo } from './repo.js';

const EXEC_KINDS = new Set(['sequential', 'dependency', 'parallel']);
const READY_TIMEOUT = 90_000;

interface ActiveRun {
  run: Run;
  nodes: Map<string, CanvasNode>;
  edges: CanvasEdge[];
  contextInbox: Map<string, string[]>;
  cancelled: boolean;
  maxSteps: number;
}

export interface OrchestratorEvents {
  run: [run: Run];
  task: [workspaceId: string, nodeId: string, patch: Partial<TaskNodeData>];
}

export class Orchestrator extends EventEmitter<OrchestratorEvents> {
  private active = new Map<string, ActiveRun>();
  /** Nós cujo Claude Code já disparou SessionStart (TUI pronta para receber input). */
  private ready = new Set<string>();
  private stopWaiters = new Map<string, ((msg: string | null) => void)[]>();
  private readyWaiters = new Map<string, (() => void)[]>();

  constructor(
    private repo: Repo,
    private procs: ProcessManager,
  ) {
    super();
    procs.on('agentStop', (nodeId, msg) => {
      const ws = this.stopWaiters.get(nodeId) ?? [];
      this.stopWaiters.delete(nodeId);
      ws.forEach((w) => w(msg));
    });
    procs.on('proc', (info) => {
      if (info.status === 'exited') this.ready.delete(info.nodeId);
    });
  }

  markReady(nodeId: string) {
    this.ready.add(nodeId);
    const ws = this.readyWaiters.get(nodeId) ?? [];
    this.readyWaiters.delete(nodeId);
    ws.forEach((w) => w());
  }

  activeRuns(workspaceId: string) {
    return [...this.active.values()].filter((a) => a.run.workspaceId === workspaceId).map((a) => a.run);
  }

  /** Valida o grafo e inicia uma execução. Retorna imediatamente; o progresso chega via eventos. */
  start(workspaceId: string, originNodeId: string, prompt: string): Run {
    const graph = this.repo.getGraph(workspaceId);
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const origin = nodes.get(originNodeId);
    if (!origin) throw badRequest('Nó de origem não encontrado (salve o canvas antes de executar)');
    if (origin.type !== 'claude' && origin.type !== 'task') throw badRequest('Execuções começam em um agente ou em uma tarefa');
    for (const a of this.active.values())
      if (a.run.workspaceId === workspaceId && a.run.status === 'running') throw badRequest('Já existe uma execução em andamento neste workspace');

    const edges = graph.edges;
    const cycle = findCycle(graph.nodes, edges.filter((e) => EXEC_KINDS.has(e.kind)));
    if (cycle) throw badRequest(`Ciclo detectado entre: ${cycle.map((id) => label(nodes.get(id))).join(' → ')}. Remova uma conexão para evitar loops.`);

    let basePrompt = prompt.trim();
    let initial: string[] = [];
    if (origin.type === 'task') {
      const t = origin.data as TaskNodeData;
      basePrompt = [`# Tarefa: ${t.title}`, t.description?.trim(), prompt.trim() && `\n${prompt.trim()}`].filter(Boolean).join('\n\n');
      initial = edges
        .filter((e) => e.source === origin.id || e.target === origin.id)
        .map((e) => (e.source === origin.id ? e.target : e.source))
        .filter((id) => nodes.get(id)?.type === 'claude');
      if (!initial.length) throw badRequest('Conecte a tarefa a pelo menos um agente do Claude Code');
      // Agentes que dependem de outro agente da tarefa entram depois, via dependência.
      initial = initial.filter((id) => !edges.some((e) => e.target === id && e.kind !== 'reference' && e.kind !== 'context' && initial.includes(e.source)));
    } else {
      if (!basePrompt) throw badRequest('Informe o prompt da execução');
      initial = [origin.id];
    }

    const maxSteps = graph.workspace.settings.maxRunSteps ?? 12;
    const run: Run = { id: newId(), workspaceId, originNodeId, prompt: basePrompt, status: 'running', error: null, startedAt: Date.now(), finishedAt: null, steps: [] };
    const ar: ActiveRun = { run, nodes, edges, contextInbox: new Map(), cancelled: false, maxSteps };
    this.active.set(run.id, ar);

    if (origin.type === 'task') this.setTask(workspaceId, origin.id, { status: 'doing' });
    const start = new Set<string>();
    for (const id of initial) for (const p of this.parallelClosure(ar, id)) start.add(p);
    for (const id of start) this.schedule(ar, id, id === originNodeId || initial.includes(id) ? 'início' : 'paralelo', basePrompt);
    this.persist(ar);
    return run;
  }

  cancel(runId: string) {
    const ar = this.active.get(runId);
    if (!ar) return;
    ar.cancelled = true;
    for (const s of ar.run.steps) {
      if (s.status === 'running') this.procs.interrupt(s.nodeId);
      if (s.status === 'running' || s.status === 'pending') s.status = 'cancelled';
      this.stopWaiters.get(s.nodeId)?.forEach((w) => w(null));
      this.stopWaiters.delete(s.nodeId);
    }
    this.finish(ar, 'cancelled', null);
  }

  private parallelClosure(ar: ActiveRun, id: string): string[] {
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of ar.edges)
        if (e.kind === 'parallel' && e.source === cur && ar.nodes.get(e.target)?.type === 'claude' && !out.has(e.target)) {
          out.add(e.target);
          stack.push(e.target);
        }
    }
    return [...out];
  }

  private schedule(ar: ActiveRun, nodeId: string, trigger: string, input: string) {
    if (ar.run.steps.some((s) => s.nodeId === nodeId)) return; // cada agente uma vez por execução
    if (ar.run.steps.length >= ar.maxSteps) {
      ar.run.steps.push(step(ar.run.id, nodeId, 'skipped', `${trigger} (limite de ${ar.maxSteps} passos)`, input));
      return;
    }
    const s = step(ar.run.id, nodeId, 'pending', trigger, input);
    ar.run.steps.push(s);
    void this.execute(ar, s);
  }

  private depsSatisfied(ar: ActiveRun, nodeId: string): boolean {
    const deps = ar.edges.filter((e) => e.kind === 'dependency' && e.target === nodeId && ar.nodes.get(e.source)?.type === 'claude');
    return deps.every((e) => {
      const st = ar.run.steps.find((s) => s.nodeId === e.source);
      // Origens fora desta execução não bloqueiam (evita espera eterna).
      return !st ? !this.willRun(ar, e.source) : st.status === 'done';
    });
  }

  /** Se o nó ainda pode entrar nesta execução (alcançável por arestas executáveis a partir de passos ativos). */
  private willRun(ar: ActiveRun, nodeId: string): boolean {
    const active = ar.run.steps.filter((s) => s.status === 'pending' || s.status === 'running').map((s) => s.nodeId);
    const seen = new Set<string>();
    const stack = [...active];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === nodeId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of ar.edges) if (EXEC_KINDS.has(e.kind) && e.source === cur) stack.push(e.target);
    }
    return false;
  }

  private async execute(ar: ActiveRun, s: RunStep) {
    try {
      // Dependências: aguarda até todas as origens concluírem.
      while (!this.depsSatisfied(ar, s.nodeId)) {
        if (ar.cancelled) return;
        await new Promise<void>((r) => this.once('run', () => r()));
      }
      if (ar.cancelled) return;
      const node = ar.nodes.get(s.nodeId)!;
      await this.ensureAgent(s.nodeId);
      await this.waitIdle(s.nodeId, ar);
      if (ar.cancelled) return;

      const ctx = ar.contextInbox.get(s.nodeId) ?? [];
      ar.contextInbox.delete(s.nodeId);
      const fullInput = [ctx.length ? `## Contexto compartilhado por outros agentes\n\n${ctx.join('\n\n---\n\n')}` : '', s.input].filter(Boolean).join('\n\n');
      s.input = fullInput;
      s.status = 'running';
      s.startedAt = Date.now();
      this.persist(ar);

      const done = this.waitStop(s.nodeId);
      await this.procs.sendPrompt(s.nodeId, fullInput);
      const output = await done;
      if (ar.cancelled) return;
      if (!this.procs.isRunning(s.nodeId)) throw new Error(`${label(node)} foi encerrado durante a execução`);

      s.output = output ?? '';
      s.status = 'done';
      s.finishedAt = Date.now();
      this.propagate(ar, s);
      this.persist(ar);
      this.maybeFinish(ar);
    } catch (e) {
      if (ar.cancelled) return;
      s.status = 'failed';
      s.output = (e as Error).message;
      s.finishedAt = Date.now();
      for (const o of ar.run.steps) if (o.status === 'pending') o.status = 'cancelled';
      this.finish(ar, 'failed', (e as Error).message);
    }
  }

  private propagate(ar: ActiveRun, s: RunStep) {
    const src = ar.nodes.get(s.nodeId)!;
    const out = s.output || '(sem resposta textual)';
    for (const e of ar.edges.filter((e) => e.source === s.nodeId)) {
      const target = ar.nodes.get(e.target);
      if (!target) continue;
      if (target.type === 'task') {
        this.setTask(ar.run.workspaceId, target.id, { result: out.slice(0, 4000) });
        continue;
      }
      if (target.type !== 'claude') continue;
      if (e.kind === 'context') {
        const list = ar.contextInbox.get(target.id) ?? [];
        list.push(`### ${label(src)}\n\n${out}`);
        ar.contextInbox.set(target.id, list);
      } else if (e.kind === 'sequential') {
        this.schedule(ar, target.id, `sequencial ← ${label(src)}`, `## Resultado da etapa anterior (${label(src)})\n\n${out}\n\n## Objetivo geral\n\n${ar.run.prompt}`);
      } else if (e.kind === 'dependency') {
        this.schedule(ar, target.id, `dependência ← ${label(src)}`, ar.run.prompt);
      }
      // parallel: já disparado no início; reference: nunca dispara.
    }
  }

  private maybeFinish(ar: ActiveRun) {
    if (ar.run.steps.some((s) => s.status === 'pending' || s.status === 'running')) return;
    this.finish(ar, 'done', null);
  }

  private finish(ar: ActiveRun, status: Run['status'], error: string | null) {
    if (ar.run.status !== 'running') return;
    ar.run.status = status;
    ar.run.error = error;
    ar.run.finishedAt = Date.now();
    const origin = ar.nodes.get(ar.run.originNodeId);
    if (origin?.type === 'task') {
      const last = [...ar.run.steps].reverse().find((s) => s.status === 'done');
      this.setTask(ar.run.workspaceId, origin.id, status === 'done' ? { status: 'done', result: last?.output?.slice(0, 4000) } : { status: status === 'failed' ? 'blocked' : 'todo' });
    }
    this.persist(ar);
    this.active.delete(ar.run.id);
  }

  private persist(ar: ActiveRun) {
    this.repo.saveRun(ar.run);
    this.emit('run', structuredClone(ar.run));
  }

  private setTask(workspaceId: string, nodeId: string, patch: Partial<TaskNodeData>) {
    this.repo.patchNodeData(nodeId, patch);
    this.emit('task', workspaceId, nodeId, patch);
  }

  /** Inicia o agente (se preciso) e espera o Claude Code ficar pronto para receber texto. */
  async ensureAgent(nodeId: string) {
    if (this.procs.isRunning(nodeId) && this.ready.has(nodeId)) return;
    let timer: NodeJS.Timeout | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      const list = this.readyWaiters.get(nodeId) ?? [];
      list.push(resolve);
      this.readyWaiters.set(nodeId, list);
      timer = setTimeout(() => reject(new Error('O agente não ficou pronto a tempo. Verifique o terminal (confirmação de confiança da pasta ou login pendente).')), READY_TIMEOUT);
    });
    try {
      if (!this.procs.isRunning(nodeId)) await this.procs.start(nodeId);
      else if (Date.now() - (this.procs.get(nodeId)?.startedAt ?? 0) > 15_000) {
        // Processo rodando há tempo suficiente sem SessionStart registrado: considera pronto.
        this.markReady(nodeId);
      }
      await ready;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 1500)); // TUI terminando de desenhar
  }

  private async waitIdle(nodeId: string, ar: ActiveRun) {
    while (!ar.cancelled) {
      const st = this.procs.get(nodeId)?.agentState;
      if (st !== 'working' && st !== 'waiting') return;
      await this.waitStop(nodeId);
    }
  }

  /** Resolve no próximo fim de turno (hook Stop) do agente. */
  waitStop(nodeId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const list = this.stopWaiters.get(nodeId) ?? [];
      list.push(resolve);
      this.stopWaiters.set(nodeId, list);
    });
  }

  /** "Compartilhar contexto agora": cola a última resposta da origem no terminal do destino. */
  async pushContext(edgeId: string, workspaceId: string, submit: boolean) {
    const g = this.repo.getGraph(workspaceId);
    const e = g.edges.find((x) => x.id === edgeId);
    if (!e) throw badRequest('Conexão não encontrada');
    const src = g.nodes.find((n) => n.id === e.source);
    const dst = g.nodes.find((n) => n.id === e.target);
    if (dst?.type !== 'claude') throw badRequest('O destino precisa ser um agente do Claude Code');
    let text: string | null = null;
    if (src?.type === 'claude') text = this.repo.getSession(src.id)?.lastMessage ?? null;
    else if (src?.type === 'note') text = (src.data as any).text;
    else if (src?.type === 'task') text = `# Tarefa: ${(src.data as TaskNodeData).title}\n\n${(src.data as TaskNodeData).description}`;
    if (!text) throw badRequest('A origem ainda não tem conteúdo para compartilhar');
    if (!this.procs.isRunning(dst.id)) throw badRequest('Inicie o agente de destino primeiro');
    const msg = `## Contexto compartilhado por ${label(src)}\n\n${text}`;
    if (submit) await this.procs.sendPrompt(dst.id, msg);
    else this.procs.write(dst.id, `\x1b[200~${msg}\x1b[201~`);
  }
}

function step(runId: string, nodeId: string, status: RunStep['status'], trigger: string, input: string): RunStep {
  return { id: newId(), runId, nodeId, status, trigger, input, output: null, startedAt: null, finishedAt: null };
}

function label(n: CanvasNode | undefined): string {
  if (!n) return '?';
  const d = n.data as any;
  return d.name || d.title || d.label || n.type;
}

/** Detecta ciclo (DFS) e retorna o caminho do ciclo, se houver. */
export function findCycle(nodes: CanvasNode[], edges: CanvasEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const dfs = (u: string): string[] | null => {
    state.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) return [...stack.slice(stack.indexOf(v)), v];
      if (!state.has(v)) {
        const c = dfs(v);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(u, 2);
    return null;
  };
  for (const n of nodes) if (!state.has(n.id)) {
    const c = dfs(n.id);
    if (c) return c;
  }
  return null;
}

export type { ClaudeNodeData };
