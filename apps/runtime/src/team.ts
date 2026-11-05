/**
 * Equipe: ferramentas que um agente do Claude Code usa (via MCP "nexo") para criar outros
 * agentes visíveis no canvas — cada um com terminal próprio, onde o usuário acompanha e intervém.
 *
 * Proteções: no máximo MAX_PER_WORKSPACE agentes criados por workspace (por execução do runtime);
 * nomes únicos; diretório precisa existir; um agente só fala com agentes do próprio workspace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_NODE_SIZE, type CanvasEdge, type CanvasNode, type ClaudeNodeData } from '@nexo/shared';
import type { Orchestrator } from './orchestrator.js';
import type { ProcessManager } from './processes.js';
import { badRequest, newId, notFound, type Repo } from './repo.js';

const MAX_PER_WORKSPACE = 12;
const FRESH_MS = 20_000;

export class Team {
  private spawned = new Map<string, number>();
  /** Agentes com prompt enviado pela equipe e turno ainda não concluído. */
  private busy = new Set<string>();
  /** Nós/arestas recém-criados que o autosave do cliente ainda pode não conhecer. */
  private fresh = new Map<string, { at: number; workspaceId: string; edges: CanvasEdge[] }>();

  constructor(
    private repo: Repo,
    private procs: ProcessManager,
    private orch: Orchestrator,
    private broadcast: (workspaceId: string, projectId: string, nodes: CanvasNode[], edges: CanvasEdge[], by: string) => void,
    private notice: (message: string, nodeId: string) => void,
  ) {
    procs.on('agentStop', (nodeId) => this.busy.delete(nodeId));
  }

  /** O que o autosave do workspace não pode apagar ainda. */
  protectedFor(workspaceId: string): { nodes: Set<string>; edges: CanvasEdge[] } {
    const nodes = new Set<string>();
    const edges: CanvasEdge[] = [];
    for (const [id, f] of this.fresh) {
      if (Date.now() - f.at > FRESH_MS) this.fresh.delete(id);
      else if (f.workspaceId === workspaceId) {
        nodes.add(id);
        edges.push(...f.edges);
      }
    }
    return { nodes, edges };
  }

  async call(callerId: string, tool: string, args: any): Promise<string> {
    const caller = this.repo.getNode(callerId);
    if (!caller || caller.type !== 'claude') throw notFound('Agente de origem');
    switch (tool) {
      case 'spawn_agent':
        return this.spawn(caller, args ?? {});
      case 'list_agents':
        return this.list(caller);
      case 'send_to_agent':
        return this.send(caller, String(args?.name ?? ''), String(args?.message ?? ''));
      case 'wait_for_agents':
        return this.wait(caller, Array.isArray(args?.names) ? args.names.map(String) : [], Number(args?.timeout_seconds) || 900);
      case 'read_agent':
        return this.read(caller, String(args?.name ?? ''));
      default:
        throw badRequest(`Ferramenta desconhecida: ${tool}`);
    }
  }

  private agents(workspaceId: string) {
    return this.repo.getGraph(workspaceId).nodes.filter((n) => n.type === 'claude') as (CanvasNode<'claude'>)[];
  }

  private byName(caller: CanvasNode & { workspaceId: string }, name: string) {
    const n = this.agents(caller.workspaceId).find((a) => a.data.name.toLowerCase() === name.trim().toLowerCase());
    if (!n) throw badRequest(`Não existe agente "${name}" neste canvas. Use list_agents.`);
    return n;
  }

  private async spawn(caller: CanvasNode & { workspaceId: string }, a: any): Promise<string> {
    const wsId = caller.workspaceId;
    const count = this.spawned.get(wsId) ?? 0;
    if (count >= MAX_PER_WORKSPACE) throw badRequest(`Limite de ${MAX_PER_WORKSPACE} agentes criados neste canvas atingido. Reaproveite os existentes com send_to_agent.`);
    const parent = caller.data as ClaudeNodeData;
    const prompt = String(a.prompt ?? '').trim();
    if (!prompt) throw badRequest('Informe "prompt": a tarefa inicial do novo agente.');

    // Diretório: relativo ao do agente que criou.
    const base = parent.worktreePath && parent.isolate ? parent.worktreePath : parent.cwd;
    const cwd = a.cwd ? path.resolve(base, String(a.cwd)) : base;
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw badRequest(`Diretório não existe: ${cwd}`);

    const existing = this.agents(wsId);
    let name = String(a.name ?? '').trim() || 'Agente';
    const taken = new Set(existing.map((n) => n.data.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${String(a.name ?? 'Agente').trim()} ${i}`;

    // Posição: coluna à direita de quem criou, empilhando os irmãos.
    const graph = this.repo.getGraph(wsId);
    const abs = (n: CanvasNode): { x: number; y: number } => {
      const p = n.parentId ? graph.nodes.find((g) => g.id === n.parentId) : undefined;
      return p ? { x: n.x + abs(p).x, y: n.y + abs(p).y } : { x: n.x, y: n.y };
    };
    const origin = abs(caller);
    const siblings = existing.filter((n) => n.data.spawnedBy === caller.id).length;
    const size = DEFAULT_NODE_SIZE.claude;
    const node: CanvasNode<'claude'> = {
      id: newId(),
      type: 'claude',
      x: origin.x + caller.width + 140,
      y: origin.y + siblings * (size.height + 48),
      ...size,
      parentId: null,
      z: Math.max(0, ...graph.nodes.map((n) => n.z)) + 1,
      data: {
        name,
        cwd,
        role: String(a.role ?? '').trim(),
        permissionMode: parent.permissionMode,
        model: String(a.model ?? '').trim() || parent.model,
        agent: String(a.agent ?? '').trim() || undefined,
        isolate: !!a.isolate,
        team: true,
        spawnedBy: caller.id,
      },
    };
    const edge: CanvasEdge = { id: newId(), source: caller.id, target: node.id, sourceHandle: null, targetHandle: null, kind: 'reference', label: 'criou' };
    this.repo.addToGraph(wsId, [node], [edge]);
    this.fresh.set(node.id, { at: Date.now(), workspaceId: wsId, edges: [edge] });
    this.spawned.set(wsId, count + 1);
    this.broadcast(wsId, this.repo.getWorkspace(wsId).projectId, [node], [edge], parent.name);
    this.notice(`${parent.name} criou o agente ${name}`, node.id);

    await this.orch.ensureAgent(node.id);
    this.busy.add(node.id);
    await this.procs.sendPrompt(node.id, prompt);
    return `Agente "${name}" criado e trabalhando em ${cwd}. O usuário vê o terminal dele no canvas. Use wait_for_agents(["${name}"]) para receber o resultado.`;
  }

  private list(caller: CanvasNode & { workspaceId: string }): string {
    const rows = this.agents(caller.workspaceId).map((n) => {
      const p = this.procs.get(n.id);
      const s = this.repo.getSession(n.id);
      const state = !p ? 'parado' : { working: 'trabalhando', waiting: 'aguardando o usuário', idle: 'livre', unknown: 'rodando' }[p.agentState];
      const last = s?.lastMessage ? ` — última resposta: ${s.lastMessage.replace(/\s+/g, ' ').slice(0, 160)}` : '';
      return `- ${n.data.name}${n.id === caller.id ? ' (você)' : ''} [${state}] em ${n.data.cwd}${last}`;
    });
    return rows.join('\n') || 'Nenhum agente.';
  }

  private async send(caller: CanvasNode & { workspaceId: string }, name: string, message: string): Promise<string> {
    if (!message.trim()) throw badRequest('Mensagem vazia');
    const n = this.byName(caller, name);
    if (n.id === caller.id) throw badRequest('Não dá para mandar mensagem para você mesmo');
    await this.orch.ensureAgent(n.id);
    // Agente ocupado: espera terminar o turno antes de digitar.
    const st = this.procs.get(n.id)?.agentState;
    if (st === 'working' || st === 'waiting') await this.orch.waitStop(n.id);
    this.busy.add(n.id);
    await this.procs.sendPrompt(n.id, `## Mensagem de ${(caller.data as ClaudeNodeData).name}\n\n${message}`);
    return `Mensagem enviada para ${n.data.name}.`;
  }

  private async wait(caller: CanvasNode & { workspaceId: string }, names: string[], timeoutSec: number): Promise<string> {
    const targets = names.length ? names.map((nm) => this.byName(caller, nm)) : this.agents(caller.workspaceId).filter((n) => n.data.spawnedBy === caller.id);
    if (!targets.length) return 'Nenhum agente para esperar.';
    const limit = Math.min(Math.max(timeoutSec, 10), 3600) * 1000;
    const results = await Promise.all(
      targets.map(async (n) => {
        const working = () => this.busy.has(n.id) || this.procs.get(n.id)?.agentState === 'working';
        if (working()) {
          let timer: NodeJS.Timeout | undefined;
          const done = await Promise.race([this.orch.waitStop(n.id).then(() => true), new Promise<boolean>((r) => (timer = setTimeout(() => r(false), limit)))]);
          clearTimeout(timer);
          if (!done) return `### ${n.data.name}\n(ainda trabalhando após ${Math.round(limit / 1000)}s)`;
        }
        if (this.procs.get(n.id)?.agentState === 'waiting') return `### ${n.data.name}\n(aguardando o usuário no terminal dele)`;
        return `### ${n.data.name}\n${this.repo.getSession(n.id)?.lastMessage ?? '(sem resposta textual)'}`;
      }),
    );
    return results.join('\n\n');
  }

  private read(caller: CanvasNode & { workspaceId: string }, name: string): string {
    const n = this.byName(caller, name);
    return this.repo.getSession(n.id)?.lastMessage ?? '(sem resposta ainda)';
  }
}
