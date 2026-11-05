import { randomUUID } from 'node:crypto';
import type {
  CanvasEdge,
  CanvasNode,
  Folder,
  Project,
  ProjectExport,
  ProjectSummary,
  Run,
  RunStep,
  SessionRecord,
  Viewport,
  Workspace,
  WorkspaceGraph,
  WorkspaceSettings,
} from '@nexo/shared';
import { type DB, tx } from './db.js';

type Row = Record<string, any>;
const now = () => Date.now();
export const newId = () => randomUUID();

const toFolder = (r: Row): Folder => ({ id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort, createdAt: r.created_at });
const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  folderId: r.folder_id,
  description: r.description,
  rootPath: r.root_path,
  color: r.color,
  archived: !!r.archived,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lastOpenedAt: r.last_opened_at,
});
const toWorkspace = (r: Row): Workspace => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  sort: r.sort,
  viewport: JSON.parse(r.viewport),
  settings: JSON.parse(r.settings),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toNode = (r: Row): CanvasNode => ({
  id: r.id,
  type: r.type,
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  parentId: r.parent_id,
  z: r.z,
  data: JSON.parse(r.data),
});
const toEdge = (r: Row): CanvasEdge => ({
  id: r.id,
  source: r.source,
  target: r.target,
  sourceHandle: r.source_handle,
  targetHandle: r.target_handle,
  kind: r.kind,
  label: r.label ?? undefined,
});
export const toSession = (r: Row): SessionRecord => ({
  nodeId: r.node_id,
  workspaceId: r.workspace_id,
  kind: r.kind,
  claudeSessionId: r.claude_session_id,
  cwd: r.cwd,
  status: r.status,
  agentState: r.agent_state,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  exitCode: r.exit_code,
  lastMessage: r.last_message,
  lastActivityAt: r.last_activity_at,
  resumable: r.kind === 'claude' && !!r.has_conversation && !!r.claude_session_id,
});

export class Repo {
  constructor(readonly db: DB) {}

  // ── folders ──
  listFolders(): Folder[] {
    return (this.db.prepare('SELECT * FROM folders ORDER BY sort, name').all() as Row[]).map(toFolder);
  }
  createFolder(name: string, parentId: string | null = null): Folder {
    const id = newId();
    this.db.prepare('INSERT INTO folders (id,name,parent_id,sort,created_at) VALUES (?,?,?,?,?)').run(id, name, parentId, 0, now());
    return toFolder(this.db.prepare('SELECT * FROM folders WHERE id=?').get(id) as Row);
  }
  updateFolder(id: string, patch: Partial<Pick<Folder, 'name' | 'parentId' | 'sort'>>): Folder {
    const f = this.db.prepare('SELECT * FROM folders WHERE id=?').get(id) as Row | undefined;
    if (!f) throw notFound('Pasta');
    if (patch.parentId === id) throw badRequest('Uma pasta não pode ser filha dela mesma');
    this.db
      .prepare('UPDATE folders SET name=?, parent_id=?, sort=? WHERE id=?')
      .run(patch.name ?? f.name, patch.parentId !== undefined ? patch.parentId : f.parent_id, patch.sort ?? f.sort, id);
    return toFolder(this.db.prepare('SELECT * FROM folders WHERE id=?').get(id) as Row);
  }
  deleteFolder(id: string) {
    // Projetos dentro da pasta voltam para a raiz (ON DELETE SET NULL); subpastas são removidas.
    tx(this.db, () => {
      const ids = this.descendantFolderIds(id);
      for (const fid of ids) this.db.prepare('UPDATE projects SET folder_id=NULL WHERE folder_id=?').run(fid);
      this.db.prepare('DELETE FROM folders WHERE id=?').run(id);
    });
  }
  private descendantFolderIds(id: string): string[] {
    const out = [id];
    for (const r of this.db.prepare('SELECT id FROM folders WHERE parent_id=?').all(id) as Row[]) out.push(...this.descendantFolderIds(r.id));
    return out;
  }

  // ── projects ──
  listProjects(opts: { q?: string; archived?: boolean } = {}): ProjectSummary[] {
    const where: string[] = [];
    const args: any[] = [];
    if (opts.archived !== undefined) {
      where.push('p.archived = ?');
      args.push(opts.archived ? 1 : 0);
    }
    if (opts.q) {
      where.push('(p.name LIKE ? OR p.description LIKE ? OR p.root_path LIKE ?)');
      const q = `%${opts.q}%`;
      args.push(q, q, q);
    }
    const rows = this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM workspaces w WHERE w.project_id=p.id) AS ws_count,
          (SELECT COUNT(*) FROM nodes n JOIN workspaces w ON w.id=n.workspace_id WHERE w.project_id=p.id) AS node_count,
          (SELECT COUNT(*) FROM nodes n JOIN workspaces w ON w.id=n.workspace_id WHERE w.project_id=p.id AND n.type='claude') AS agent_count
         FROM projects p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY COALESCE(p.last_opened_at, p.updated_at) DESC`,
      )
      .all(...args) as Row[];
    const taskRows = this.db
      .prepare(
        `SELECT w.project_id AS pid, json_extract(n.data,'$.status') AS status, COUNT(*) AS c
         FROM nodes n JOIN workspaces w ON w.id=n.workspace_id WHERE n.type='task' GROUP BY pid, status`,
      )
      .all() as Row[];
    return rows.map((r) => {
      const tasks = { todo: 0, doing: 0, done: 0, blocked: 0 };
      for (const t of taskRows) if (t.pid === r.id && t.status in tasks) (tasks as any)[t.status] = t.c;
      return { ...toProject(r), workspaceCount: r.ws_count, nodeCount: r.node_count, agentCount: r.agent_count, tasks };
    });
  }
  getProject(id: string): Project {
    const r = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) as Row | undefined;
    if (!r) throw notFound('Projeto');
    return toProject(r);
  }
  createProject(input: { name: string; folderId?: string | null; description?: string; rootPath?: string | null; color?: string }): Project {
    const id = newId();
    const t = now();
    tx(this.db, () => {
      this.db
        .prepare('INSERT INTO projects (id,name,folder_id,description,root_path,color,archived,created_at,updated_at,last_opened_at) VALUES (?,?,?,?,?,?,0,?,?,NULL)')
        .run(id, input.name, input.folderId ?? null, input.description ?? '', input.rootPath ?? null, input.color ?? '#8b5cf6', t, t);
      this.insertWorkspace(id, 'Workspace Principal', 0);
    });
    return this.getProject(id);
  }
  updateProject(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>): Project {
    const p = this.getProject(id);
    const m = { ...p, ...patch };
    this.db
      .prepare('UPDATE projects SET name=?, folder_id=?, description=?, root_path=?, color=?, archived=?, updated_at=?, last_opened_at=? WHERE id=?')
      .run(m.name, m.folderId, m.description, m.rootPath, m.color, m.archived ? 1 : 0, patch.lastOpenedAt !== undefined && Object.keys(patch).length === 1 ? p.updatedAt : now(), m.lastOpenedAt, id);
    return this.getProject(id);
  }
  touchProject(id: string) {
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now(), id);
  }
  deleteProject(id: string) {
    this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
  }

  exportProject(id: string): ProjectExport {
    const project = this.getProject(id);
    const workspaces = this.listWorkspaces(id).map((w) => {
      const g = this.getGraph(w.id);
      return { ...w, nodes: g.nodes, edges: g.edges };
    });
    return { format: 'nexo-project', version: 1, exportedAt: now(), project, workspaces };
  }

  /** Importa um export (ou duplica um projeto), sempre gerando novos IDs. */
  importProject(data: ProjectExport, overrides: Partial<Pick<Project, 'name' | 'folderId'>> = {}): Project {
    if (data?.format !== 'nexo-project') throw badRequest('Arquivo não é um export do ALt.nexo');
    const pid = newId();
    const t = now();
    tx(this.db, () => {
      const p = data.project;
      const folderExists = (fid: string | null | undefined) => !!fid && !!this.db.prepare('SELECT 1 FROM folders WHERE id=?').get(fid);
      const folderId = overrides.folderId !== undefined ? overrides.folderId : folderExists(p.folderId) ? p.folderId : null;
      this.db
        .prepare('INSERT INTO projects (id,name,folder_id,description,root_path,color,archived,created_at,updated_at,last_opened_at) VALUES (?,?,?,?,?,?,0,?,?,NULL)')
        .run(pid, overrides.name ?? p.name, folderId, p.description ?? '', p.rootPath ?? null, p.color ?? '#8b5cf6', t, t);
      data.workspaces.forEach((w, i) => {
        const wid = newId();
        this.db
          .prepare('INSERT INTO workspaces (id,project_id,name,sort,viewport,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(wid, pid, w.name, i, JSON.stringify(w.viewport ?? { x: 0, y: 0, zoom: 1 }), JSON.stringify(w.settings ?? {}), t, t);
        const idMap = new Map<string, string>();
        for (const n of w.nodes) idMap.set(n.id, newId());
        for (const n of w.nodes) {
          const data = { ...(n.data as any) };
          // Sessões do Claude pertencem ao nó original: a cópia começa uma conversa nova.
          if (n.type === 'claude') {
            delete data.claudeSessionId;
            delete data.worktreePath;
          }
          this.insertNode(wid, { ...n, id: idMap.get(n.id)!, parentId: n.parentId ? idMap.get(n.parentId) ?? null : null, data });
        }
        for (const e of w.edges) {
          if (!idMap.has(e.source) || !idMap.has(e.target)) continue;
          this.insertEdge(wid, { ...e, id: newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! });
        }
      });
    });
    return this.getProject(pid);
  }

  // ── workspaces ──
  listWorkspaces(projectId: string): Workspace[] {
    return (this.db.prepare('SELECT * FROM workspaces WHERE project_id=? ORDER BY sort, created_at').all(projectId) as Row[]).map(toWorkspace);
  }
  getWorkspace(id: string): Workspace {
    const r = this.db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) as Row | undefined;
    if (!r) throw notFound('Workspace');
    return toWorkspace(r);
  }
  private insertWorkspace(projectId: string, name: string, sort: number): string {
    const id = newId();
    const t = now();
    this.db.prepare('INSERT INTO workspaces (id,project_id,name,sort,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, projectId, name, sort, t, t);
    return id;
  }
  createWorkspace(projectId: string, name: string): Workspace {
    this.getProject(projectId);
    const max = (this.db.prepare('SELECT COALESCE(MAX(sort),-1) m FROM workspaces WHERE project_id=?').get(projectId) as Row).m;
    const id = this.insertWorkspace(projectId, name, max + 1);
    this.touchProject(projectId);
    return this.getWorkspace(id);
  }
  updateWorkspace(id: string, patch: { name?: string; sort?: number; viewport?: Viewport; settings?: WorkspaceSettings }): Workspace {
    const w = this.getWorkspace(id);
    this.db
      .prepare('UPDATE workspaces SET name=?, sort=?, viewport=?, settings=?, updated_at=? WHERE id=?')
      .run(patch.name ?? w.name, patch.sort ?? w.sort, JSON.stringify(patch.viewport ?? w.viewport), JSON.stringify({ ...w.settings, ...patch.settings }), now(), id);
    return this.getWorkspace(id);
  }
  deleteWorkspace(id: string) {
    const w = this.getWorkspace(id);
    if (this.listWorkspaces(w.projectId).length <= 1) throw badRequest('O projeto precisa de ao menos um workspace');
    this.db.prepare('DELETE FROM workspaces WHERE id=?').run(id);
  }
  duplicateWorkspace(id: string): Workspace {
    const w = this.getWorkspace(id);
    const g = this.getGraph(id);
    const copy = this.createWorkspace(w.projectId, `${w.name} (cópia)`);
    const idMap = new Map(g.nodes.map((n) => [n.id, newId()]));
    tx(this.db, () => {
      for (const n of g.nodes) {
        const data = { ...(n.data as any) };
        if (n.type === 'claude') {
          delete data.claudeSessionId;
          delete data.worktreePath;
        }
        this.insertNode(copy.id, { ...n, id: idMap.get(n.id)!, parentId: n.parentId ? idMap.get(n.parentId) ?? null : null, data });
      }
      for (const e of g.edges) this.insertEdge(copy.id, { ...e, id: newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! });
    });
    return this.updateWorkspace(copy.id, { viewport: w.viewport, settings: w.settings });
  }

  // ── grafo ──
  getGraph(workspaceId: string): WorkspaceGraph {
    const workspace = this.getWorkspace(workspaceId);
    const nodes = (this.db.prepare('SELECT * FROM nodes WHERE workspace_id=? ORDER BY z').all(workspaceId) as Row[]).map(toNode);
    const edges = (this.db.prepare('SELECT * FROM edges WHERE workspace_id=?').all(workspaceId) as Row[]).map(toEdge);
    return { workspace, nodes, edges };
  }
  getNode(id: string): (CanvasNode & { workspaceId: string }) | null {
    const r = this.db.prepare('SELECT * FROM nodes WHERE id=?').get(id) as Row | undefined;
    return r ? { ...toNode(r), workspaceId: r.workspace_id } : null;
  }
  /** Mescla campos em node.data (usado pelo runtime, ex.: ID de sessão ou status de tarefa). */
  patchNodeData(id: string, patch: Record<string, unknown>) {
    const n = this.getNode(id);
    if (!n) return;
    this.db.prepare('UPDATE nodes SET data=? WHERE id=?').run(JSON.stringify({ ...(n.data as any), ...patch }), id);
  }
  /** Insere nós/arestas criados pelo runtime, sem tocar no resto do grafo. */
  addToGraph(workspaceId: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
    const ws = this.getWorkspace(workspaceId);
    tx(this.db, () => {
      for (const n of nodes) this.insertNode(workspaceId, n);
      for (const e of edges) this.insertEdge(workspaceId, e);
      this.touchProject(ws.projectId);
    });
  }
  private insertNode(workspaceId: string, n: CanvasNode) {
    this.db
      .prepare('INSERT OR REPLACE INTO nodes (id,workspace_id,type,x,y,width,height,parent_id,z,data) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(n.id, workspaceId, n.type, n.x, n.y, n.width, n.height, n.parentId ?? null, n.z ?? 0, JSON.stringify(n.data ?? {}));
  }
  private insertEdge(workspaceId: string, e: CanvasEdge) {
    this.db
      .prepare('INSERT OR REPLACE INTO edges (id,workspace_id,source,target,source_handle,target_handle,kind,label) VALUES (?,?,?,?,?,?,?,?)')
      .run(e.id, workspaceId, e.source, e.target, e.sourceHandle ?? null, e.targetHandle ?? null, e.kind ?? 'reference', e.label ?? null);
  }

  /**
   * Salva o grafo completo do workspace numa transação (autosave do frontend).
   * Campos controlados pelo runtime (ID de sessão do Claude, worktree) são preservados
   * mesmo que o cliente envie uma versão antiga.
   * Retorna os IDs de nós removidos para que o runtime encerre processos associados.
   */
  saveGraph(
    workspaceId: string,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    viewport?: Viewport,
    /** Criados pelo runtime há pouco: o cliente pode ainda não ter recebido — não remover. */
    protect: { nodes: Set<string>; edges: CanvasEdge[] } = { nodes: new Set(), edges: [] },
  ): { removed: string[] } {
    const ws = this.getWorkspace(workspaceId);
    return tx(this.db, () => {
      const existing = new Map(
        (this.db.prepare('SELECT id, data FROM nodes WHERE workspace_id=?').all(workspaceId) as Row[]).map((r) => [r.id as string, JSON.parse(r.data)]),
      );
      const keep = new Set([...nodes.map((n) => n.id), ...[...protect.nodes].filter((id) => existing.has(id))]);
      const sentEdges = new Set(edges.map((e) => e.id));
      edges = [...edges, ...protect.edges.filter((e) => !sentEdges.has(e.id))];
      const removed = [...existing.keys()].filter((id) => !keep.has(id));
      for (const id of removed) this.db.prepare('DELETE FROM nodes WHERE id=?').run(id);
      for (const n of nodes) {
        const prev = existing.get(n.id);
        const data: any = { ...(n.data as any) };
        if (prev && n.type === 'claude') {
          if (prev.claudeSessionId) data.claudeSessionId = prev.claudeSessionId;
          if (prev.worktreePath) data.worktreePath = prev.worktreePath;
        }
        this.insertNode(workspaceId, { ...n, data });
      }
      this.db.prepare('DELETE FROM edges WHERE workspace_id=?').run(workspaceId);
      for (const e of edges) if (keep.has(e.source) && keep.has(e.target)) this.insertEdge(workspaceId, e);
      this.db
        .prepare('UPDATE workspaces SET viewport=?, updated_at=? WHERE id=?')
        .run(JSON.stringify(viewport ?? ws.viewport), now(), workspaceId);
      this.touchProject(ws.projectId);
      return { removed };
    });
  }

  // ── sessões ──
  getSession(nodeId: string): SessionRecord | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE node_id=?').get(nodeId) as Row | undefined;
    return r ? toSession(r) : null;
  }
  listSessions(workspaceId: string): SessionRecord[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE workspace_id=?').all(workspaceId) as Row[]).map(toSession);
  }
  upsertSession(s: Partial<Omit<SessionRecord, 'resumable'>> & { nodeId: string; hasConversation?: boolean }): SessionRecord {
    const prev = this.db.prepare('SELECT * FROM sessions WHERE node_id=?').get(s.nodeId) as Row | undefined;
    const m = {
      workspace_id: s.workspaceId ?? prev?.workspace_id,
      kind: s.kind ?? prev?.kind,
      claude_session_id: s.claudeSessionId !== undefined ? s.claudeSessionId : prev?.claude_session_id ?? null,
      cwd: s.cwd ?? prev?.cwd ?? '',
      status: s.status ?? prev?.status ?? 'stopped',
      agent_state: s.agentState ?? prev?.agent_state ?? 'unknown',
      started_at: s.startedAt !== undefined ? s.startedAt : prev?.started_at ?? null,
      ended_at: s.endedAt !== undefined ? s.endedAt : prev?.ended_at ?? null,
      exit_code: s.exitCode !== undefined ? s.exitCode : prev?.exit_code ?? null,
      last_message: s.lastMessage !== undefined ? s.lastMessage : prev?.last_message ?? null,
      last_activity_at: s.lastActivityAt !== undefined ? s.lastActivityAt : prev?.last_activity_at ?? null,
      has_conversation: s.hasConversation !== undefined ? (s.hasConversation ? 1 : 0) : prev?.has_conversation ?? 0,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sessions (node_id,workspace_id,kind,claude_session_id,cwd,status,agent_state,started_at,ended_at,exit_code,last_message,last_activity_at,has_conversation)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(s.nodeId, m.workspace_id, m.kind, m.claude_session_id, m.cwd, m.status, m.agent_state, m.started_at, m.ended_at, m.exit_code, m.last_message, m.last_activity_at, m.has_conversation);
    return this.getSession(s.nodeId)!;
  }
  deleteSession(nodeId: string) {
    this.db.prepare('DELETE FROM sessions WHERE node_id=?').run(nodeId);
  }
  /** Recuperação após encerramento inesperado: sessões marcadas como "running" não têm mais processo. */
  markOrphanSessionsInterrupted(): number {
    return Number(
      this.db.prepare("UPDATE sessions SET status='interrupted', agent_state='unknown', ended_at=COALESCE(ended_at, ?) WHERE status='running'").run(now()).changes,
    );
  }

  // ── execuções (orquestração) ──
  saveRun(run: Run) {
    tx(this.db, () => {
      this.db
        .prepare('INSERT OR REPLACE INTO runs (id,workspace_id,origin_node_id,prompt,status,error,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(run.id, run.workspaceId, run.originNodeId, run.prompt, run.status, run.error, run.startedAt, run.finishedAt);
      run.steps.forEach((s, i) => {
        this.db
          .prepare('INSERT OR REPLACE INTO run_steps (id,run_id,node_id,status,trigger,input,output,started_at,finished_at,seq) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(s.id, run.id, s.nodeId, s.status, s.trigger, s.input, s.output, s.startedAt, s.finishedAt, i);
      });
    });
  }
  listRuns(workspaceId: string, limit = 30): Run[] {
    const runs = this.db.prepare('SELECT * FROM runs WHERE workspace_id=? ORDER BY started_at DESC LIMIT ?').all(workspaceId, limit) as Row[];
    return runs.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      originNodeId: r.origin_node_id,
      prompt: r.prompt,
      status: r.status,
      error: r.error,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      steps: (this.db.prepare('SELECT * FROM run_steps WHERE run_id=? ORDER BY seq').all(r.id) as Row[]).map(
        (s): RunStep => ({
          id: s.id,
          runId: s.run_id,
          nodeId: s.node_id,
          status: s.status,
          trigger: s.trigger,
          input: s.input,
          output: s.output,
          startedAt: s.started_at,
          finishedAt: s.finished_at,
        }),
      ),
    }));
  }
  markOrphanRunsFailed() {
    this.db.prepare("UPDATE runs SET status='failed', error='Runtime encerrado durante a execução', finished_at=? WHERE status='running'").run(now());
    this.db.prepare("UPDATE run_steps SET status='cancelled' WHERE status IN ('pending','running')").run();
  }

  // ── settings ──
  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined;
    return r ? JSON.parse(r.value) : fallback;
  }
  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, JSON.stringify(value));
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new HttpError(404, `${what} não encontrado`);
export const badRequest = (msg: string) => new HttpError(400, msg);
