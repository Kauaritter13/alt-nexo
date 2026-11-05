/**
 * Runtime local do ALt.nexo: HTTP (REST) + WebSocket, ligado apenas em 127.0.0.1.
 *
 * Autenticação:
 *  - Desktop: o Electron gera um token aleatório em memória a cada execução e o entrega à janela.
 *  - Navegador: a cada início o runtime imprime um link de pareamento com um código efêmero.
 *    O navegador troca o código por um token de dispositivo; o runtime guarda só o SHA-256 dele.
 *  - Hooks do Claude Code: token próprio, efêmero, injetado apenas no ambiente dos PTYs.
 *  - Host/Origin são validados (proteção contra DNS rebinding e páginas de terceiros).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { buildScanGraph, type CanvasEdge, type CanvasNode, type ClientMsg, type ProjectExport, type ServerMsg, type SystemInfo } from '@nexo/shared';
import { backupDatabase, openDatabase } from './db.js';
import { HttpError, Repo, badRequest, newId, notFound } from './repo.js';
import { scanFolder } from './scan.js';
import { Team } from './team.js';
import { ProcessManager } from './processes.js';
import { Orchestrator } from './orchestrator.js';
import { FileService } from './fsapi.js';
import { claudeStatus, slash, writeHookSettings } from './claude.js';
import { gitClone, gitInit, gitStatus } from './git.js';
import { VERSION, defaultShell, resolveDataDir } from './config.js';

export interface RuntimeOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  /** Diretório com o build da interface web (servido como SPA). */
  staticDir?: string;
  /** Token fixo (modo desktop). */
  token?: string;
  desktop?: boolean;
  /** Comando que o Claude Code usa para executar o hook (padrão: node + hook.cjs). */
  hookCommand?: string;
  /** Como rodar scripts Node (servidor MCP de equipe). No desktop: o próprio Electron com ELECTRON_RUN_AS_NODE. */
  nodeRuntime?: { command: string; env?: Record<string, string> };
  log?: (msg: string) => void;
}

export interface Runtime {
  url: string;
  port: number;
  pairingUrl: string;
  dataDir: string;
  close: () => Promise<void>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type Handler = (ctx: { req: http.IncomingMessage; params: Record<string, string>; query: URLSearchParams; body: any }) => unknown | Promise<unknown>;

export async function startRuntime(opts: RuntimeOptions = {}): Promise<Runtime> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const host = opts.host ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Por segurança, o runtime só escuta em loopback (127.0.0.1).');
  const dataDir = resolveDataDir(opts.dataDir);
  const db = openDatabase(dataDir);
  const repo = new Repo(db);

  // Recuperação após encerramento inesperado.
  const orphans = repo.markOrphanSessionsInterrupted();
  repo.markOrphanRunsFailed();
  if (orphans) log(`[ALt.nexo] ${orphans} sessão(ões) marcadas como interrompidas (encerramento anterior inesperado).`);

  // Backup automático diário.
  const lastBackup = repo.getSetting<number>('lastAutoBackup', 0);
  if (Date.now() - lastBackup > 24 * 3600_000 && repo.listProjects().length) {
    try {
      backupDatabase(db, dataDir, 'auto', 14);
      repo.setSetting('lastAutoBackup', Date.now());
    } catch (e) {
      log(`[ALt.nexo] backup automático falhou: ${(e as Error).message}`);
    }
  }

  const pairingCode = randomBytes(18).toString('base64url');
  const hookToken = randomBytes(24).toString('base64url');
  const desktopToken = opts.token;

  const isAuthed = (token: string | null | undefined) => {
    if (!token) return false;
    if (desktopToken && safeEq(token, desktopToken)) return true;
    const hashes = repo.getSetting<string[]>('deviceTokenHashes', []);
    const h = sha(token);
    return hashes.some((x) => safeEq(x, h));
  };

  const files = new FileService(repo);
  const server = http.createServer();
  const clients = new Set<WebSocket>();
  const subs = new Map<WebSocket, Set<string>>();

  // Porta precisa ser conhecida antes de gerar o settings de hooks.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 7420, host, () => resolve());
  });
  const port = (server.address() as any).port as number;
  const url = `http://127.0.0.1:${port}`;

  const hookScript = path.join(dataDir, 'hooks', 'hook.cjs');
  installHookScript(hookScript);
  const mcpScript = path.join(dataDir, 'hooks', 'mcp.cjs');
  installHookScript(mcpScript, 'mcp.cjs');
  const hookCommand = opts.hookCommand ?? `"${slash(nodeExecutable())}" "${slash(hookScript)}"`;
  const hookSettingsFile = writeHookSettings(dataDir, { command: hookCommand });
  const nodeRt = opts.nodeRuntime ?? { command: nodeExecutable() };

  const procs = new ProcessManager(repo, dataDir, { url, token: hookToken }, hookSettingsFile, { command: nodeRt.command, args: [mcpScript], env: nodeRt.env });
  const orch = new Orchestrator(repo, procs);

  const broadcast = (msg: ServerMsg) => {
    const s = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === 1) c.send(s);
  };
  const team = new Team(
    repo,
    procs,
    orch,
    (workspaceId, projectId, nodes, edges, by) => broadcast({ t: 'graphAdd', workspaceId, projectId, nodes, edges, by }),
    (message, nodeId) => broadcast({ t: 'notice', level: 'info', message, nodeId }),
  );
  procs.on('output', (nodeId, data) => {
    const s = JSON.stringify({ t: 'output', nodeId, data } satisfies ServerMsg);
    for (const [c, set] of subs) if (set.has(nodeId) && c.readyState === 1) c.send(s);
  });
  procs.on('proc', (proc) => broadcast({ t: 'proc', proc }));
  procs.on('session', (session) => broadcast({ t: 'session', session }));
  procs.on('notice', (level, message, nodeId) => broadcast({ t: 'notice', level, message, nodeId }));
  procs.on('nodePatched', (workspaceId, nodeId, patch) => broadcast({ t: 'task', workspaceId, nodeId, patch: patch as any }));
  orch.on('run', (run) => broadcast({ t: 'run', run }));
  orch.on('task', (workspaceId, nodeId, patch) => broadcast({ t: 'task', workspaceId, nodeId, patch }));

  // ───────── rotas ─────────
  const routes: { method: string; re: RegExp; keys: string[]; h: Handler; open?: boolean }[] = [];
  const route = (method: string, pattern: string, h: Handler, open = false) => {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, h, open });
  };

  route('GET', '/api/health', () => ({ ok: true, version: VERSION, desktop: !!opts.desktop }), true);
  route(
    'POST',
    '/api/auth/pair',
    ({ body }) => {
      if (!body?.code || !safeEq(String(body.code), pairingCode)) throw new HttpError(401, 'Código de pareamento inválido');
      const token = randomBytes(32).toString('base64url');
      const hashes = repo.getSetting<string[]>('deviceTokenHashes', []);
      repo.setSetting('deviceTokenHashes', [...hashes, sha(token)].slice(-20));
      return { token };
    },
    true,
  );
  route('POST', '/api/auth/revoke-all', () => {
    repo.setSetting('deviceTokenHashes', []);
    return { ok: true };
  });
  route(
    'POST',
    '/api/hooks/claude',
    ({ req, body }) => {
      const t = String(req.headers['x-nexo-hook-token'] ?? '');
      if (!safeEq(t, hookToken)) throw new HttpError(401, 'hook token inválido');
      const nodeId = String(body?.nodeId ?? '');
      if (body?.payload?.hook_event_name === 'SessionStart') orch.markReady(nodeId);
      procs.handleHook(nodeId, body?.payload ?? {});
      return { ok: true };
    },
    true,
  );

  // Ferramentas de equipe (servidor MCP "nexo" dentro de cada agente) — mesmo token dos hooks.
  route(
    'POST',
    '/api/team/:tool',
    async ({ req, params, body }) => {
      const t = String(req.headers['x-nexo-hook-token'] ?? '');
      if (!safeEq(t, hookToken)) throw new HttpError(401, 'token inválido');
      return { text: await team.call(String(body?.nodeId ?? ''), params.tool, body?.args) };
    },
    true,
  );
  route('GET', '/api/procs', () => procs.list());

  route('GET', '/api/system', async ({ query }): Promise<SystemInfo> => ({
    version: VERSION,
    platform: process.platform,
    desktop: !!opts.desktop,
    dataDir,
    homeDir: os.homedir(),
    defaultShell: defaultShell(),
    claude: await claudeStatus(query.get('refresh') === '1'),
  }));
  route('GET', '/api/settings', () => ({ allowedRoots: repo.getSetting<string[]>('allowedRoots', []), defaultProjectsDir: repo.getSetting('defaultProjectsDir', path.join(os.homedir(), 'projetos')) }));
  route('PATCH', '/api/settings', ({ body }) => {
    if (Array.isArray(body.allowedRoots)) repo.setSetting('allowedRoots', body.allowedRoots.map(String));
    if (typeof body.defaultProjectsDir === 'string') repo.setSetting('defaultProjectsDir', body.defaultProjectsDir);
    return { ok: true };
  });

  // pastas
  route('GET', '/api/folders', () => repo.listFolders());
  route('POST', '/api/folders', ({ body }) => repo.createFolder(req(body.name, 'name'), body.parentId ?? null));
  route('PATCH', '/api/folders/:id', ({ params, body }) => repo.updateFolder(params.id, body));
  route('DELETE', '/api/folders/:id', ({ params }) => (repo.deleteFolder(params.id), { ok: true }));

  // projetos
  route('GET', '/api/projects', ({ query }) =>
    repo.listProjects({ q: query.get('q') || undefined, archived: query.has('archived') ? query.get('archived') === '1' : undefined }),
  );
  route('POST', '/api/projects', async ({ body }) => {
    const rootPath: string | null = body.rootPath?.trim() || null;
    if (rootPath) {
      if (body.cloneUrl) await gitClone(body.cloneUrl, rootPath);
      else if (body.createDir) fs.mkdirSync(rootPath, { recursive: true });
      else if (!fs.existsSync(rootPath)) throw badRequest(`Diretório não existe: ${rootPath}`);
      if (body.gitInit && !fs.existsSync(path.join(rootPath, '.git'))) await gitInit(rootPath);
    }
    const project = repo.createProject({ name: req(body.name, 'name'), folderId: body.folderId ?? null, description: body.description, rootPath, color: body.color });
    // "Montar canvas": lê a pasta e já cria os grupos de agentes, cérebro e arquivos.
    if (rootPath && body.seed) {
      const ws = repo.listWorkspaces(project.id)[0];
      const g = buildScanGraph(scanFolder(rootPath), { origin: { x: 0, y: 0 }, shell: defaultShell(), newId });
      repo.saveGraph(ws.id, g.nodes, g.edges, { x: 80, y: 80, zoom: 0.55 });
    }
    return project;
  });
  route('GET', '/api/scan', ({ query }) => scanFolder(req(query.get('path'), 'path')));
  route('GET', '/api/projects/:id', ({ params }) => repo.getProject(params.id));
  route('PATCH', '/api/projects/:id', ({ params, body }) => repo.updateProject(params.id, body));
  route('DELETE', '/api/projects/:id', ({ params }) => {
    for (const w of repo.listWorkspaces(params.id)) for (const p of procs.list(w.id)) procs.stop(p.nodeId);
    repo.deleteProject(params.id);
    return { ok: true };
  });
  route('POST', '/api/projects/:id/open', ({ params }) => repo.updateProject(params.id, { lastOpenedAt: Date.now() }));
  route('POST', '/api/projects/:id/duplicate', ({ params }) => {
    const exp = repo.exportProject(params.id);
    return repo.importProject(exp, { name: `${exp.project.name} (cópia)` });
  });
  route('GET', '/api/projects/:id/export', ({ params }) => repo.exportProject(params.id));
  route('POST', '/api/projects/import', ({ body }) => repo.importProject(body as ProjectExport));

  // workspaces
  route('GET', '/api/projects/:id/workspaces', ({ params }) => repo.listWorkspaces(params.id));
  route('POST', '/api/projects/:id/workspaces', ({ params, body }) => repo.createWorkspace(params.id, req(body.name, 'name')));
  route('PATCH', '/api/workspaces/:id', ({ params, body }) => repo.updateWorkspace(params.id, body));
  route('DELETE', '/api/workspaces/:id', ({ params }) => {
    for (const p of procs.list(params.id)) procs.stop(p.nodeId);
    repo.deleteWorkspace(params.id);
    return { ok: true };
  });
  route('POST', '/api/workspaces/:id/duplicate', ({ params }) => repo.duplicateWorkspace(params.id));
  route('GET', '/api/workspaces/:id/graph', ({ params }) => repo.getGraph(params.id));
  route('PUT', '/api/workspaces/:id/graph', ({ params, body }) => {
    const { removed } = repo.saveGraph(params.id, (body.nodes ?? []) as CanvasNode[], (body.edges ?? []) as CanvasEdge[], body.viewport, team.protectedFor(params.id));
    for (const id of removed) {
      procs.stop(id);
      repo.deleteSession(id);
    }
    return { ok: true, savedAt: Date.now() };
  });
  route('GET', '/api/workspaces/:id/runtime', ({ params }) => ({
    procs: procs.list(params.id),
    sessions: repo.listSessions(params.id),
    runs: repo.listRuns(params.id),
  }));

  // processos
  route('POST', '/api/nodes/:id/start', ({ params, body }) => procs.start(params.id, { fresh: !!body?.fresh, cols: body?.cols, rows: body?.rows }));
  route('POST', '/api/nodes/:id/stop', ({ params }) => (procs.stop(params.id), { ok: true }));
  route('POST', '/api/nodes/:id/interrupt', ({ params }) => (procs.interrupt(params.id), { ok: true }));
  route('POST', '/api/nodes/:id/restart', ({ params, body }) => procs.restart(params.id, { fresh: !!body?.fresh }));
  route('POST', '/api/nodes/:id/prompt', async ({ params, body }) => (await procs.sendPrompt(params.id, req(body.text, 'text')), { ok: true }));
  route('DELETE', '/api/nodes/:id/log', ({ params }) => (procs.clearLog(params.id), { ok: true }));

  // orquestração
  route('POST', '/api/runs', ({ body }) => orch.start(req(body.workspaceId, 'workspaceId'), req(body.originNodeId, 'originNodeId'), String(body.prompt ?? '')));
  route('POST', '/api/runs/:id/cancel', ({ params }) => (orch.cancel(params.id), { ok: true }));
  route('POST', '/api/edges/:id/push', async ({ params, body }) => (await orch.pushContext(params.id, req(body.workspaceId, 'workspaceId'), !!body.submit), { ok: true }));

  // arquivos
  route('GET', '/api/fs/home', () => ({ home: files.home(), drives: files.drives(), roots: files.roots() }));
  route('GET', '/api/fs/list', ({ query }) => files.list(req(query.get('path'), 'path'), { showHidden: query.get('hidden') === '1' }));
  route('GET', '/api/fs/read', ({ query }) => files.read(req(query.get('path'), 'path')));
  route('PUT', '/api/fs/write', ({ body }) => (files.write(req(body.path, 'path'), String(body.content ?? '')), { ok: true }));
  route('POST', '/api/fs/mkdir', ({ body }) => (files.mkdir(req(body.path, 'path')), { ok: true }));

  // git
  route('GET', '/api/git/status', ({ query }) => gitStatus(req(query.get('path'), 'path')));
  route('POST', '/api/git/init', async ({ body }) => (await gitInit(req(body.path, 'path')), { ok: true }));

  // backup
  route('POST', '/api/backup', () => ({ file: backupDatabase(db, dataDir, 'manual') }));
  route('GET', '/api/backups', () =>
    fs
      .readdirSync(path.join(dataDir, 'backups'))
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ name: f, size: fs.statSync(path.join(dataDir, 'backups', f)).size }))
      .sort((a, b) => b.name.localeCompare(a.name)),
  );

  // ───────── HTTP ─────────
  const allowedHost = (h: string | undefined) => !!h && new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${port}$`).test(h);
  const allowedOrigin = (o: string | undefined) => !o || o === 'null' || /^(https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?|file:\/\/)$/.test(o) || o.startsWith('file://');
  const tokenOf = (req: http.IncomingMessage, q: URLSearchParams) => {
    const a = req.headers.authorization;
    if (a?.startsWith('Bearer ')) return a.slice(7);
    return q.get('token');
  };

  server.on('request', async (req, res) => {
    const u = new URL(req.url ?? '/', url);
    if (!allowedHost(req.headers.host)) return send(res, 421, { error: 'Host não permitido' });
    if (!allowedOrigin(req.headers.origin)) return send(res, 403, { error: 'Origem não permitida' });

    if (!u.pathname.startsWith('/api/')) return serveStatic(opts.staticDir, u.pathname, res);

    const r = routes.find((x) => x.method === req.method && x.re.test(u.pathname));
    if (!r) return send(res, 404, { error: 'Rota não encontrada' });
    if (!r.open && !isAuthed(tokenOf(req, u.searchParams))) return send(res, 401, { error: 'Não autorizado' });
    try {
      const m = u.pathname.match(r.re)!;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method!) ? await readJson(req) : {};
      const out = await r.h({ req, params, query: u.searchParams, body });
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log(`[ALt.nexo] erro em ${req.method} ${u.pathname}: ${(e as Error).stack}`);
      send(res, status, { error: (e as Error).message });
    }
  });

  // ───────── WebSocket ─────────
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url ?? '/', url);
    if (u.pathname !== '/ws' || (!allowedHost(req.headers.host)) || !allowedOrigin(req.headers.origin) || !isAuthed(u.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    subs.set(ws, new Set());
    ws.send(JSON.stringify({ t: 'hello', version: VERSION } satisfies ServerMsg));
    ws.on('message', (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      switch (m.t) {
        case 'attach':
          subs.get(ws)!.add(m.nodeId);
          ws.send(JSON.stringify({ t: 'scrollback', nodeId: m.nodeId, data: procs.scrollback(m.nodeId) } satisfies ServerMsg));
          break;
        case 'detach':
          subs.get(ws)!.delete(m.nodeId);
          break;
        case 'input':
          procs.write(m.nodeId, m.data);
          break;
        case 'resize':
          procs.resize(m.nodeId, m.cols, m.rows);
          break;
        case 'ping':
          ws.send(JSON.stringify({ t: 'pong' }));
          break;
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      subs.delete(ws);
    });
  });

  const pairingUrl = `${url}/?pair=${pairingCode}`;
  log(`[ALt.nexo] runtime ${VERSION} em ${url}  (dados: ${dataDir})`);

  let closed = false;
  return {
    url,
    port,
    pairingUrl,
    dataDir,
    close: async () => {
      if (closed) return;
      closed = true;
      procs.stopAll();
      await new Promise((r) => setTimeout(r, 300));
      for (const c of clients) c.terminate();
      await new Promise<void>((r) => server.close(() => r()));
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function req<T>(v: T | null | undefined, name: string): T {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) throw badRequest(`Campo obrigatório: ${name}`);
  return v;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(s);
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 50 * 1024 * 1024) {
        reject(new HttpError(413, 'Corpo da requisição muito grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(badRequest('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serveStatic(dir: string | undefined, pathname: string, res: http.ServerResponse) {
  if (!dir || !fs.existsSync(dir)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('ALt.nexo runtime em execução. Interface web não empacotada neste modo (use npm run dev:web).');
  }
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const root = path.resolve(dir);
  let file = path.join(root, safe);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    ...(ext === '.html'
      ? {
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src https: http:; object-src 'none'; base-uri 'self'",
        }
      : {}),
  });
  fs.createReadStream(file).pipe(res);
}

/** Copia um script (hook, servidor MCP) para o diretório de dados (caminho estável, fora do pacote/asar). */
function installHookScript(dest: string, name = 'hook.cjs') {
  const candidates = [
    path.join(__dirnameSafe(), name),
    path.join(__dirnameSafe(), '..', 'src', name),
    path.join((process as any).resourcesPath ?? '', name),
  ];
  const src = candidates.find((c) => c && fs.existsSync(c));
  if (!src) throw new Error(`${name} não encontrado no pacote do runtime`);
  fs.copyFileSync(src, dest);
}

function __dirnameSafe(): string {
  // CJS (bundle) tem __dirname; em ESM (tsx/dev) usa import.meta.url.
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}

/** Executável Node para rodar o hook: o próprio Node do runtime, ou `node` do PATH quando dentro do Electron. */
function nodeExecutable(): string {
  if (!process.versions.electron) return process.execPath;
  return 'node';
}
