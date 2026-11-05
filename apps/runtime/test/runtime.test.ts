/**
 * Testes de integração do runtime: sobe o servidor real (porta aleatória, banco temporário)
 * e exercita REST, WebSocket, PTY real, persistência e validações do orquestrador.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startRuntime, type Runtime } from '../src/server.js';
import { findCycle } from '../src/orchestrator.js';
import { lastAssistantText } from '../src/claude.js';

const TOKEN = 'test-token-123';
let rt: Runtime;
let dataDir: string;
let workDir: string;

const api = async (method: string, p: string, body?: unknown, token = TOKEN) => {
  const r = await fetch(rt.url + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  return { status: r.status, json };
};

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-test-'));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-work-'));
  rt = await startRuntime({ port: 0, dataDir, token: TOKEN, log: () => {} });
});

after(async () => {
  await rt.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('rejeita requisições sem token e com Host inválido', async () => {
  assert.equal((await api('GET', '/api/projects', undefined, '')).status, 401);
  assert.equal((await api('GET', '/api/health', undefined, '')).status, 200);
  const status = await new Promise<number>((resolve, reject) => {
    const u = new URL(rt.url);
    http.get({ hostname: u.hostname, port: u.port, path: '/api/health', headers: { host: 'evil.com' } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    }).on('error', reject);
  });
  assert.equal(status, 421);
});

test('pareamento troca código por token de dispositivo', async () => {
  const code = new URL(rt.pairingUrl).searchParams.get('pair')!;
  assert.equal((await api('POST', '/api/auth/pair', { code: 'errado' }, '')).status, 401);
  const { json } = await api('POST', '/api/auth/pair', { code }, '');
  assert.ok(json.token);
  assert.equal((await api('GET', '/api/projects', undefined, json.token)).status, 200);
});

test('pastas, projetos, workspaces e grafo persistem', async () => {
  const folder = (await api('POST', '/api/folders', { name: 'Ideias' })).json;
  const proj = (await api('POST', '/api/projects', { name: 'ALT.chat', folderId: folder.id, rootPath: workDir })).json;
  assert.equal(proj.folderId, folder.id);
  const wss = (await api('GET', `/api/projects/${proj.id}/workspaces`)).json;
  assert.equal(wss.length, 1);
  const ws = wss[0];

  const nodes = [
    { id: 'n1', type: 'note', x: 10, y: 20, width: 200, height: 100, parentId: null, z: 0, data: { text: 'olá', color: 'yellow' } },
    { id: 'n2', type: 'task', x: 300, y: 20, width: 200, height: 100, parentId: null, z: 1, data: { title: 'API', description: '', status: 'todo' } },
  ];
  const edges = [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null, kind: 'context' }];
  await api('PUT', `/api/workspaces/${ws.id}/graph`, { nodes, edges, viewport: { x: -50, y: 12, zoom: 0.8 } });
  const g = (await api('GET', `/api/workspaces/${ws.id}/graph`)).json;
  assert.equal(g.nodes.length, 2);
  assert.deepEqual(g.workspace.viewport, { x: -50, y: 12, zoom: 0.8 });
  assert.equal(g.edges[0].kind, 'context');
  assert.equal(g.nodes.find((n: any) => n.id === 'n1').data.text, 'olá');

  const list = (await api('GET', '/api/projects?q=ALT')).json;
  assert.equal(list.length, 1);
  assert.equal(list[0].tasks.todo, 1);

  // duplicar e exportar/importar geram novos IDs
  const dup = (await api('POST', `/api/projects/${proj.id}/duplicate`)).json;
  assert.notEqual(dup.id, proj.id);
  const exp = (await api('GET', `/api/projects/${proj.id}/export`)).json;
  assert.equal(exp.format, 'nexo-project');
  const imp = (await api('POST', '/api/projects/import', exp)).json;
  const impWs = (await api('GET', `/api/projects/${imp.id}/workspaces`)).json[0];
  const impG = (await api('GET', `/api/workspaces/${impWs.id}/graph`)).json;
  assert.equal(impG.nodes.length, 2);
  assert.ok(!impG.nodes.some((n: any) => n.id === 'n1'));
});

test('terminal real via PTY: entrada, saída por WebSocket e histórico em disco', async () => {
  const proj = (await api('POST', '/api/projects', { name: 'Term', rootPath: workDir })).json;
  const ws = (await api('GET', `/api/projects/${proj.id}/workspaces`)).json[0];
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  await api('PUT', `/api/workspaces/${ws.id}/graph`, {
    nodes: [{ id: 't1', type: 'terminal', x: 0, y: 0, width: 400, height: 300, parentId: null, z: 0, data: { name: 'T', cwd: workDir, shell } }],
    edges: [],
  });
  const sock = new WebSocket(`${rt.url.replace('http', 'ws')}/ws?token=${TOKEN}`);
  await new Promise((r) => sock.once('open', r));
  let out = '';
  sock.on('message', (m) => {
    const msg = JSON.parse(String(m));
    if (msg.t === 'output' && msg.nodeId === 't1') out += msg.data;
  });
  sock.send(JSON.stringify({ t: 'attach', nodeId: 't1' }));
  const start = await api('POST', '/api/nodes/t1/start', { cols: 100, rows: 30 });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  assert.equal(start.json.status, 'running');
  await new Promise((r) => setTimeout(r, 1500));
  sock.send(JSON.stringify({ t: 'input', nodeId: 't1', data: 'echo NEXO_OK_42\r' }));
  const deadline = Date.now() + 10000;
  while (!out.includes('NEXO_OK_42') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.ok(out.includes('NEXO_OK_42'), 'saída do terminal não recebida');

  const rtInfo = (await api('GET', `/api/workspaces/${ws.id}/runtime`)).json;
  assert.equal(rtInfo.procs.length, 1);
  assert.equal(rtInfo.sessions[0].status, 'running');

  await api('POST', '/api/nodes/t1/stop');
  await new Promise((r) => setTimeout(r, 1500));
  const after = (await api('GET', `/api/workspaces/${ws.id}/runtime`)).json;
  assert.equal(after.procs.length, 0);
  assert.equal(after.sessions[0].status, 'stopped');
  // histórico continua disponível após o processo encerrar
  const log = fs.readFileSync(path.join(dataDir, 'logs', 't1.log'), 'utf8');
  assert.ok(log.includes('NEXO_OK_42'));
  sock.close();
});

test('arquivos: leitura restrita a pastas autorizadas', async () => {
  const f = path.join(workDir, 'nota.md');
  fs.writeFileSync(f, '# oi');
  const ok = await api('GET', `/api/fs/read?path=${encodeURIComponent(f)}`);
  assert.equal(ok.json.content, '# oi');
  const outside = path.join(os.homedir(), 'nexo-nao-autorizado.txt');
  const denied = await api('GET', `/api/fs/read?path=${encodeURIComponent(outside)}`);
  assert.equal(denied.status, 403);
  await api('PUT', '/api/fs/write', { path: path.join(workDir, 'sub', 'novo.txt'), content: 'abc' });
  assert.equal(fs.readFileSync(path.join(workDir, 'sub', 'novo.txt'), 'utf8'), 'abc');
});

test('orquestrador rejeita ciclos e fluxos sem agentes', async () => {
  const n = (id: string) => ({ id, type: 'claude', x: 0, y: 0, width: 1, height: 1, parentId: null, z: 0, data: {} as any });
  const e = (id: string, s: string, t: string, kind: any) => ({ id, source: s, target: t, sourceHandle: null, targetHandle: null, kind });
  assert.deepEqual(findCycle([n('a'), n('b')] as any, [e('1', 'a', 'b', 'sequential'), e('2', 'b', 'a', 'sequential')]), ['a', 'b', 'a']);
  assert.equal(findCycle([n('a'), n('b')] as any, [e('1', 'a', 'b', 'sequential')]), null);

  const proj = (await api('POST', '/api/projects', { name: 'Flow' })).json;
  const ws = (await api('GET', `/api/projects/${proj.id}/workspaces`)).json[0];
  await api('PUT', `/api/workspaces/${ws.id}/graph`, {
    nodes: [
      { ...n('a'), data: { name: 'A', cwd: workDir } },
      { ...n('b'), data: { name: 'B', cwd: workDir } },
      { id: 'tk', type: 'task', x: 0, y: 0, width: 1, height: 1, parentId: null, z: 0, data: { title: 'T', description: '', status: 'todo' } },
    ],
    edges: [e('1', 'a', 'b', 'sequential'), e('2', 'b', 'a', 'dependency')],
  });
  const r = await api('POST', '/api/runs', { workspaceId: ws.id, originNodeId: 'a', prompt: 'x' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Ciclo/);
  const r2 = await api('POST', '/api/runs', { workspaceId: ws.id, originNodeId: 'tk', prompt: '' });
  assert.equal(r2.status, 400);
});

test('extrai a última resposta do assistente de uma transcrição', () => {
  const f = path.join(workDir, 't.jsonl');
  const lines = [
    { type: 'user', message: { content: 'primeiro' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'antigo' }] } },
    { type: 'user', message: { content: 'segundo' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Parte 1' }, { type: 'tool_use', id: 'x' }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Parte 2' }] } },
  ];
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n'));
  assert.equal(lastAssistantText(f), 'Parte 1\n\nParte 2');
});

test('isolamento: cria git worktree dedicado por agente (idempotente)', async () => {
  const { ensureAgentWorktree, git } = await import('../src/git.js');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-repo-'));
  await git(repo, ['init', '-q']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x');
  await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  const wt = await ensureAgentWorktree(repo, 'Backend', 'abcdef123');
  assert.ok(fs.existsSync(path.join(wt, 'a.txt')), 'worktree sem arquivos');
  assert.match(wt, /\.nexo-worktrees/);
  assert.equal(await ensureAgentWorktree(repo, 'Backend', 'abcdef123'), wt);
  const branches = await git(repo, ['branch', '--list', 'nexo/*']);
  assert.match(branches, /nexo\/backend-abcdef/);
  await git(repo, ['worktree', 'remove', '--force', wt]);
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(path.join(path.dirname(repo), '.nexo-worktrees'), { recursive: true, force: true });
});
