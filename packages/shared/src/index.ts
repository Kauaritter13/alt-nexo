/**
 * @nexo/shared — tipos de domínio e protocolo compartilhados entre
 * runtime (Node), interface web (React) e desktop (Electron).
 */

// ───────────────────────── Domínio ─────────────────────────

export type ID = string;

export interface Folder {
  id: ID;
  name: string;
  parentId: ID | null;
  sort: number;
  createdAt: number;
}

export interface Project {
  id: ID;
  name: string;
  folderId: ID | null;
  description: string;
  /** Diretório do código no disco (opcional — projetos de ideias não precisam). */
  rootPath: string | null;
  color: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
}

export interface ProjectSummary extends Project {
  workspaceCount: number;
  nodeCount: number;
  agentCount: number;
  tasks: { todo: number; doing: number; done: number; blocked: number };
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkspaceSettings {
  snapToGrid?: boolean;
  showMinimap?: boolean;
  /** Limite de passos de uma execução de fluxo (proteção contra loops). */
  maxRunSteps?: number;
}

export interface Workspace {
  id: ID;
  projectId: ID;
  name: string;
  sort: number;
  viewport: Viewport;
  settings: WorkspaceSettings;
  createdAt: number;
  updatedAt: number;
}

export type NodeKind = 'claude' | 'terminal' | 'note' | 'task' | 'site' | 'file' | 'group';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';

export interface ClaudeNodeData {
  name: string;
  cwd: string;
  /** Função do agente — enviada via --append-system-prompt. */
  role: string;
  permissionMode: PermissionMode;
  model: string;
  /** ID de sessão do Claude Code (UUID) usado em --session-id / --resume. */
  claudeSessionId?: string;
  /** Subagente definido em <cwd>/.claude/agents — enviado via --agent (o Claude Code assume a definição dele). */
  agent?: string;
  /**
   * Equipe: o agente recebe as ferramentas do ALt.nexo (MCP "nexo") para criar outros agentes
   * visíveis no canvas, mandar mensagens e esperar resultados. Padrão: ligado.
   */
  team?: boolean;
  /** Nó que criou este agente pela ferramenta de equipe. */
  spawnedBy?: string;
  /** Executa o agente num git worktree próprio para não sobrescrever outros agentes. */
  isolate?: boolean;
  worktreePath?: string;
}

export interface TerminalNodeData {
  name: string;
  cwd: string;
  shell: string;
}

export interface NoteNodeData {
  text: string;
  color: string;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';

export interface TaskNodeData {
  title: string;
  description: string;
  status: TaskStatus;
  result?: string;
}

export interface SiteNodeData {
  url: string;
}

export interface FileNodeData {
  path: string;
}

export interface GroupNodeData {
  label: string;
  color: string;
}

export interface NodeDataMap {
  claude: ClaudeNodeData;
  terminal: TerminalNodeData;
  note: NoteNodeData;
  task: TaskNodeData;
  site: SiteNodeData;
  file: FileNodeData;
  group: GroupNodeData;
}

export interface CanvasNode<K extends NodeKind = NodeKind> {
  id: ID;
  type: K;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: ID | null;
  z: number;
  data: NodeDataMap[K];
}

/**
 * Comportamento das conexões:
 * - reference:  só indica relação. Nunca dispara nada.
 * - context:    ao concluir, a saída da origem é anexada como contexto ao próximo prompt do destino
 *               (ou enviada manualmente com "Compartilhar contexto agora").
 * - dependency: o destino só inicia após TODAS as origens de dependência concluírem (recebe o prompt original).
 * - sequential: a saída da origem vira a entrada do destino quando a origem concluir.
 * - parallel:   o destino inicia junto com a origem, com o mesmo prompt.
 */
export type EdgeKind = 'reference' | 'context' | 'dependency' | 'sequential' | 'parallel';

export const EDGE_KINDS: { kind: EdgeKind; label: string; description: string }[] = [
  { kind: 'reference', label: 'Referência', description: 'Apenas indica que os elementos se relacionam.' },
  { kind: 'context', label: 'Contexto', description: 'Encaminha a última saída da origem como contexto para o destino.' },
  { kind: 'dependency', label: 'Dependência', description: 'O destino aguarda a conclusão da origem antes de iniciar.' },
  { kind: 'sequential', label: 'Sequencial', description: 'A saída da origem alimenta a próxima etapa.' },
  { kind: 'parallel', label: 'Paralelo', description: 'Destino inicia ao mesmo tempo que a origem, com o mesmo prompt.' },
];

export interface CanvasEdge {
  id: ID;
  source: ID;
  target: ID;
  sourceHandle: string | null;
  targetHandle: string | null;
  kind: EdgeKind;
  label?: string;
}

export interface WorkspaceGraph {
  workspace: Workspace;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// ───────────────────────── Processos / sessões ─────────────────────────

export type ProcStatus = 'starting' | 'running' | 'exited';
/** Estado do agente, derivado dos hooks oficiais do Claude Code. */
export type AgentState = 'idle' | 'working' | 'waiting' | 'unknown';

export interface ProcInfo {
  nodeId: ID;
  workspaceId: ID;
  projectId: ID;
  kind: 'claude' | 'terminal';
  status: ProcStatus;
  agentState: AgentState;
  pid: number | null;
  startedAt: number;
  exitCode: number | null;
  claudeSessionId: string | null;
  cwd: string;
}

/** Metadados persistidos de uma sessão (sobrevivem ao fechamento do app). */
export interface SessionRecord {
  nodeId: ID;
  workspaceId: ID;
  kind: 'claude' | 'terminal';
  claudeSessionId: string | null;
  cwd: string;
  status: 'running' | 'stopped' | 'interrupted' | 'exited';
  agentState: AgentState;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
  lastMessage: string | null;
  lastActivityAt: number | null;
  /** true se o histórico do Claude Code existe e pode ser retomado com --resume. */
  resumable: boolean;
}

// ───────────────────────── Orquestração ─────────────────────────

export type RunStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface RunStep {
  id: ID;
  runId: ID;
  nodeId: ID;
  status: StepStatus;
  /** Por que o passo foi disparado (aresta/tipo). */
  trigger: string;
  input: string;
  output: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface Run {
  id: ID;
  workspaceId: ID;
  originNodeId: ID;
  prompt: string;
  status: RunStatus;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  steps: RunStep[];
}

// ───────────────────────── Sistema ─────────────────────────

export interface SystemInfo {
  version: string;
  platform: string;
  desktop: boolean;
  dataDir: string;
  homeDir: string;
  defaultShell: string;
  claude: {
    path: string | null;
    version: string | null;
    loggedIn: boolean | null;
    authMethod: string | null;
    error: string | null;
  };
}

export interface FsEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  remote: string | null;
  changes: { path: string; code: string }[];
  log: { hash: string; subject: string; author: string; date: string }[];
  worktrees: { path: string; branch: string | null }[];
}

// ───────────────────────── Leitura de pasta ─────────────────────────

/** Agente, skill ou comando do Claude Code encontrado em .claude/ */
export interface ScanAgent {
  name: string;
  description: string;
  model: string;
  tools: string[];
  /** Arquivo de definição (.md). */
  path: string;
  /** Pasta que contém o .claude/ — onde o Claude Code enxerga essa definição. */
  home: string;
}

export type BrainKind = 'instructions' | 'vault' | 'memory' | 'docs';

/** Conhecimento que os agentes leem: CLAUDE.md, cofres Obsidian, memória, documentação. */
export interface ScanBrain {
  kind: BrainKind;
  name: string;
  path: string;
  /** Arquivo de entrada para abrir no canvas. */
  entry: string | null;
  notes: number;
}

export interface ScanFiles {
  total: number;
  dirs: number;
  byKind: { kind: string; count: number }[];
  stack: string[];
  subprojects: { name: string; path: string; stack: string[] }[];
  readme: string | null;
  git: boolean;
  /** A varredura parou no limite de arquivos. */
  truncated: boolean;
}

export interface FolderScan {
  root: string;
  name: string;
  agents: ScanAgent[];
  skills: ScanAgent[];
  commands: ScanAgent[];
  brain: ScanBrain[];
  mcp: string[];
  files: ScanFiles;
  scannedAt: number;
}

export const BRAIN_LABEL: Record<BrainKind, string> = {
  instructions: 'Instruções',
  vault: 'Cofre de notas',
  memory: 'Memória',
  docs: 'Documentação',
};

/**
 * Monta o canvas a partir da leitura de uma pasta: três grupos (Agentes, Cérebro, Arquivos)
 * lado a lado a partir de `origin`. Posições dos filhos são relativas ao grupo.
 */
export function buildScanGraph(scan: FolderScan, opts: { origin: { x: number; y: number }; shell: string; newId: () => string }): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const PAD = 40;
  const TOP = 64;
  const GAP = 32;
  let x = opts.origin.x;
  let z = 1;

  const group = (label: string, color: string, children: Omit<CanvasNode, 'parentId' | 'z' | 'id'>[]) => {
    if (!children.length) return [] as string[];
    const gid = opts.newId();
    const w = Math.max(...children.map((c) => c.x + c.width)) + PAD;
    const h = Math.max(...children.map((c) => c.y + c.height)) + PAD;
    nodes.push({ id: gid, type: 'group', x, y: opts.origin.y, width: w, height: h, parentId: null, z: 0, data: { label, color } });
    const ids = children.map((c) => {
      const id = opts.newId();
      nodes.push({ ...c, id, parentId: gid, z: z++ } as CanvasNode);
      return id;
    });
    x += w + 120;
    return ids;
  };
  const grid = <T,>(items: T[], cols: number, size: { width: number; height: number }, make: (it: T) => Pick<CanvasNode, 'type' | 'data'>) =>
    items.map((it, i) => ({
      ...make(it),
      x: PAD + (i % cols) * (size.width + GAP),
      y: TOP + Math.floor(i / cols) * (size.height + GAP),
      ...size,
    }));
  const list = (items: ScanAgent[]) => items.map((a) => `- **${a.name}**${a.description ? ` — ${a.description}` : ''}`).join('\n');

  // Agentes: um Claude por subagente (com --agent), ou um Claude na raiz se não houver nenhum.
  const AG = DEFAULT_NODE_SIZE.claude;
  const shown = scan.agents.slice(0, 8);
  const agentNodes = grid(shown.length ? shown : [null], 2, AG, (a) => ({
    type: 'claude',
    data: a
      ? { name: a.name, cwd: a.home, role: '', agent: a.name, permissionMode: 'default', model: '', isolate: false }
      : { name: 'Claude', cwd: scan.root, role: '', permissionMode: 'default', model: '', isolate: false },
  }));
  const extra: string[] = [];
  if (scan.agents.length > shown.length) extra.push(`### Outros agentes\n${list(scan.agents.slice(shown.length))}`);
  if (scan.skills.length) extra.push(`### Skills\n${list(scan.skills)}`);
  if (scan.commands.length) extra.push(`### Comandos\n${list(scan.commands.map((c) => ({ ...c, name: `/${c.name}` })))}`);
  if (scan.mcp.length) extra.push(`### MCP\n${scan.mcp.map((m) => `- ${m}`).join('\n')}`);
  if (extra.length) {
    const rows = Math.ceil(agentNodes.length / 2);
    agentNodes.push({ type: 'note', data: { text: extra.join('\n\n'), color: 'lime' }, x: PAD, y: TOP + rows * (AG.height + GAP), width: AG.width, height: 300 });
  }
  const agentIds = group(scan.agents.length ? `Agentes (${scan.agents.length})` : 'Agentes', 'var(--claude)', agentNodes);

  // Cérebro: arquivos de entrada de cada fonte de conhecimento.
  const FL = DEFAULT_NODE_SIZE.file;
  const brain = scan.brain.filter((b) => b.entry).slice(0, 8);
  const brainIds = group(
    `Cérebro (${scan.brain.length})`,
    'var(--tone-2)',
    grid(brain, 2, FL, (b) => ({ type: 'file', data: { path: b.entry! } })),
  );
  // As instruções da raiz alimentam todos os agentes — só como referência visual.
  const rootIdx = brain.findIndex((b) => b.kind === 'instructions');
  if (rootIdx >= 0) for (const a of agentIds.slice(0, shown.length || 1)) edges.push({ id: opts.newId(), source: brainIds[rootIdx], target: a, sourceHandle: null, targetHandle: null, kind: 'reference' });

  // Arquivos: resumo + README + terminal na raiz.
  const f = scan.files;
  const summary = [
    `## ${scan.name}`,
    `**${f.total.toLocaleString('pt-BR')}${f.truncated ? '+' : ''} arquivos** em ${f.dirs.toLocaleString('pt-BR')} pastas${f.git ? ' · Git' : ''}`,
    f.stack.length ? `**Stack:** ${f.stack.join(', ')}` : '',
    f.byKind.length ? f.byKind.map((k) => `- ${k.kind}: ${k.count.toLocaleString('pt-BR')}`).join('\n') : '',
    f.subprojects.length ? `### Subprojetos\n${f.subprojects.map((s) => `- **${s.name}**${s.stack.length ? ` — ${s.stack.join(', ')}` : ''}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const fileChildren: Omit<CanvasNode, 'parentId' | 'z' | 'id'>[] = [
    { type: 'note', data: { text: summary, color: 'blue' }, x: PAD, y: TOP, width: 340, height: 360 },
    { type: 'terminal', data: { name: 'Terminal', cwd: scan.root, shell: opts.shell }, x: PAD, y: TOP + 360 + GAP, ...DEFAULT_NODE_SIZE.terminal },
  ];
  if (f.readme) fileChildren.splice(1, 0, { type: 'file', data: { path: f.readme }, x: PAD + 340 + GAP, y: TOP, width: FL.width, height: 360 });
  group('Arquivos', 'var(--tone-1)', fileChildren);

  return { nodes, edges };
}

export interface ProjectExport {
  format: 'nexo-project';
  version: 1;
  exportedAt: number;
  project: Project;
  workspaces: (Workspace & { nodes: CanvasNode[]; edges: CanvasEdge[] })[];
}

// ───────────────────────── Protocolo WebSocket ─────────────────────────

export type ClientMsg =
  | { t: 'attach'; nodeId: ID }
  | { t: 'detach'; nodeId: ID }
  | { t: 'input'; nodeId: ID; data: string }
  | { t: 'resize'; nodeId: ID; cols: number; rows: number }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'hello'; version: string }
  | { t: 'output'; nodeId: ID; data: string }
  /** Histórico do terminal ao conectar (inclui sessões anteriores, gravadas em disco). */
  | { t: 'scrollback'; nodeId: ID; data: string }
  | { t: 'proc'; proc: ProcInfo }
  | { t: 'session'; session: SessionRecord }
  | { t: 'run'; run: Run }
  | { t: 'task'; workspaceId: ID; nodeId: ID; patch: Partial<TaskNodeData> }
  /** Nós criados pelo runtime (ex.: um agente criou outro). O canvas aberto os insere. */
  | { t: 'graphAdd'; workspaceId: ID; projectId: ID; nodes: CanvasNode[]; edges: CanvasEdge[]; by: string }
  | { t: 'notice'; level: 'info' | 'warn' | 'error'; message: string; nodeId?: ID }
  | { t: 'pong' };

export const DEFAULT_NODE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  claude: { width: 640, height: 440 },
  terminal: { width: 560, height: 360 },
  note: { width: 280, height: 200 },
  task: { width: 300, height: 190 },
  site: { width: 720, height: 480 },
  file: { width: 420, height: 320 },
  group: { width: 800, height: 520 },
};
