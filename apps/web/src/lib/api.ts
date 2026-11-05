import type {
  CanvasEdge,
  CanvasNode,
  Folder,
  FolderScan,
  FsEntry,
  GitStatus,
  ProcInfo,
  Project,
  ProjectExport,
  ProjectSummary,
  Run,
  SessionRecord,
  SystemInfo,
  Viewport,
  Workspace,
  WorkspaceGraph,
  WorkspaceSettings,
} from '@nexo/shared';

const TOKEN_KEY = 'nexo.token';

/** Token: o desktop entrega via ?token= (só nesta sessão); o navegador guarda o token de dispositivo pareado. */
export function initToken(): { token: string | null; pairCode: string | null } {
  const u = new URL(location.href);
  const t = u.searchParams.get('token');
  const pair = u.searchParams.get('pair');
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  if (t || pair) {
    u.searchParams.delete('token');
    u.searchParams.delete('pair');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  return { token: getToken(), pairCode: pair };
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
}

export function setDeviceToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      keepalive: opts.keepalive,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Runtime local indisponível');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText);
  return data as T;
}

const q = (o: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  health: () => call<{ ok: boolean; version: string; desktop: boolean }>('GET', '/api/health'),
  pair: (code: string) => call<{ token: string }>('POST', '/api/auth/pair', { code }),
  revokeAll: () => call('POST', '/api/auth/revoke-all'),
  system: (refresh = false) => call<SystemInfo>('GET', `/api/system${refresh ? '?refresh=1' : ''}`),
  settings: () => call<{ allowedRoots: string[]; defaultProjectsDir: string }>('GET', '/api/settings'),
  saveSettings: (s: { allowedRoots?: string[]; defaultProjectsDir?: string }) => call('PATCH', '/api/settings', s),

  folders: () => call<Folder[]>('GET', '/api/folders'),
  createFolder: (name: string, parentId: string | null = null) => call<Folder>('POST', '/api/folders', { name, parentId }),
  updateFolder: (id: string, patch: Partial<Folder>) => call<Folder>('PATCH', `/api/folders/${id}`, patch),
  deleteFolder: (id: string) => call('DELETE', `/api/folders/${id}`),

  projects: (o: { q?: string; archived?: boolean } = {}) =>
    call<ProjectSummary[]>('GET', `/api/projects${q({ q: o.q, archived: o.archived === undefined ? undefined : o.archived ? 1 : 0 })}`),
  project: (id: string) => call<Project>('GET', `/api/projects/${id}`),
  createProject: (p: {
    name: string;
    folderId?: string | null;
    description?: string;
    rootPath?: string | null;
    color?: string;
    createDir?: boolean;
    gitInit?: boolean;
    cloneUrl?: string;
    seed?: boolean;
  }) => call<Project>('POST', '/api/projects', p),
  scan: (path: string) => call<FolderScan>('GET', `/api/scan${q({ path })}`),
  updateProject: (id: string, patch: Partial<Project>) => call<Project>('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => call('DELETE', `/api/projects/${id}`),
  openProject: (id: string) => call<Project>('POST', `/api/projects/${id}/open`),
  duplicateProject: (id: string) => call<Project>('POST', `/api/projects/${id}/duplicate`),
  exportProject: (id: string) => call<ProjectExport>('GET', `/api/projects/${id}/export`),
  importProject: (data: ProjectExport) => call<Project>('POST', '/api/projects/import', data),

  workspaces: (projectId: string) => call<Workspace[]>('GET', `/api/projects/${projectId}/workspaces`),
  createWorkspace: (projectId: string, name: string) => call<Workspace>('POST', `/api/projects/${projectId}/workspaces`, { name }),
  updateWorkspace: (id: string, patch: { name?: string; viewport?: Viewport; settings?: WorkspaceSettings }) =>
    call<Workspace>('PATCH', `/api/workspaces/${id}`, patch),
  deleteWorkspace: (id: string) => call('DELETE', `/api/workspaces/${id}`),
  duplicateWorkspace: (id: string) => call<Workspace>('POST', `/api/workspaces/${id}/duplicate`),
  graph: (id: string) => call<WorkspaceGraph>('GET', `/api/workspaces/${id}/graph`),
  saveGraph: (id: string, g: { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport }, keepalive = false) =>
    call<{ ok: true; savedAt: number }>('PUT', `/api/workspaces/${id}/graph`, g, { keepalive }),
  runtime: (id: string) => call<{ procs: ProcInfo[]; sessions: SessionRecord[]; runs: Run[] }>('GET', `/api/workspaces/${id}/runtime`),

  procs: () => call<ProcInfo[]>('GET', '/api/procs'),
  start: (nodeId: string, o: { fresh?: boolean; cols?: number; rows?: number } = {}) => call<ProcInfo>('POST', `/api/nodes/${nodeId}/start`, o),
  stop: (nodeId: string) => call('POST', `/api/nodes/${nodeId}/stop`),
  interrupt: (nodeId: string) => call('POST', `/api/nodes/${nodeId}/interrupt`),
  restart: (nodeId: string, fresh = false) => call<ProcInfo>('POST', `/api/nodes/${nodeId}/restart`, { fresh }),
  prompt: (nodeId: string, text: string) => call('POST', `/api/nodes/${nodeId}/prompt`, { text }),
  clearLog: (nodeId: string) => call('DELETE', `/api/nodes/${nodeId}/log`),

  startRun: (workspaceId: string, originNodeId: string, prompt: string) => call<Run>('POST', '/api/runs', { workspaceId, originNodeId, prompt }),
  cancelRun: (id: string) => call('POST', `/api/runs/${id}/cancel`),
  pushContext: (edgeId: string, workspaceId: string, submit: boolean) => call('POST', `/api/edges/${edgeId}/push`, { workspaceId, submit }),

  fsHome: () => call<{ home: string; drives: string[]; roots: string[] }>('GET', '/api/fs/home'),
  fsList: (path: string, hidden = false) => call<FsEntry[]>('GET', `/api/fs/list${q({ path, hidden: hidden ? 1 : undefined })}`),
  fsRead: (path: string) => call<{ path: string; content: string; size: number; binary: boolean; truncated: boolean }>('GET', `/api/fs/read${q({ path })}`),
  fsWrite: (path: string, content: string) => call('PUT', '/api/fs/write', { path, content }),
  fsMkdir: (path: string) => call('POST', '/api/fs/mkdir', { path }),

  gitStatus: (path: string) => call<GitStatus>('GET', `/api/git/status${q({ path })}`),
  gitInit: (path: string) => call('POST', '/api/git/init', { path }),

  backup: () => call<{ file: string }>('POST', '/api/backup'),
  backups: () => call<{ name: string; size: number }[]>('GET', '/api/backups'),
};
