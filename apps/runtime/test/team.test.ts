/**
 * Equipe de ponta a ponta: um agente (Claude falso num PTY real) usa o servidor MCP "nexo"
 * para criar outro agente visível no canvas, espera o resultado e conversa com ele.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startRuntime, type Runtime } from '../src/server.js';

const TOKEN = 'team-token';
let rt: Runtime;
let dataDir: string;
let workDir: string;

const api = async (method: string, p: string, body?: unknown) => {
  const r = await fetch(rt.url + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-team-'));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-team-work-'));
  fs.mkdirSync(path.join(workDir, 'web'));
  const fake = path.join(dataDir, 'claude.cmd');
  fs.writeFileSync(fake, `@"${process.execPath}" "${path.join(import.meta.dirname, 'fake-claude.cjs')}" %*\r\n`);
  process.env.NEXO_CLAUDE_PATH = fake;
  rt = await startRuntime({ port: 0, dataDir, token: TOKEN, log: () => {} });
});

after(async () => {
  await rt.close();
  delete process.env.NEXO_CLAUDE_PATH;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** Fala com o servidor MCP como o Claude Code faria (stdio, JSON-RPC por linha). */
function mcpClient(configFile: string) {
  const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')).mcpServers.nexo;
  const child = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = new Map<number, (v: any) => void>();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  const call = (method: string, params?: unknown) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  return { call, close: () => child.kill() };
}

test('agente cria outro agente visível, espera o resultado e manda mensagem', { timeout: 60_000 }, async () => {
  const proj = (await api('POST', '/api/projects', { name: 'Equipe', rootPath: workDir })).json;
  const ws = (await api('GET', `/api/projects/${proj.id}/workspaces`)).json[0];
  const lead = { id: 'lead', type: 'claude', x: 0, y: 0, width: 640, height: 440, parentId: null, z: 1, data: { name: 'Líder', cwd: workDir, role: '', permissionMode: 'default', model: '' } };
  await api('PUT', `/api/workspaces/${ws.id}/graph`, { nodes: [lead], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

  const events: any[] = [];
  const sock = new WebSocket(`${rt.url.replace('http', 'ws')}/ws?token=${TOKEN}`, { headers: { origin: rt.url } });
  await new Promise((r) => sock.once('open', r));
  sock.on('message', (m) => events.push(JSON.parse(String(m))));

  const started = await api('POST', '/api/nodes/lead/start', {});
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.projectId, proj.id);
  const cfg = path.join(dataDir, 'hooks', 'mcp-lead.json');
  assert.ok(fs.existsSync(cfg), 'config MCP por agente');

  const mcp = mcpClient(cfg);
  const init = await mcp.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'nexo');
  const tools = (await mcp.call('tools/list')).result.tools.map((t: any) => t.name);
  assert.deepEqual(tools, ['spawn_agent', 'list_agents', 'send_to_agent', 'wait_for_agents', 'read_agent']);

  const spawned = await mcp.call('tools/call', { name: 'spawn_agent', arguments: { name: 'Front', prompt: 'monte a tela de login', cwd: 'web', role: 'Só mexa em web/' } });
  assert.equal(spawned.result.isError, false, spawned.result.content[0].text);

  // O canvas aberto recebe o nó novo, com aresta "criou" a partir do líder.
  const add = events.find((e) => e.t === 'graphAdd');
  assert.ok(add, 'graphAdd transmitido');
  const front = add.nodes[0];
  assert.equal(front.data.name, 'Front');
  assert.equal(front.data.cwd, path.join(workDir, 'web'));
  assert.equal(front.data.spawnedBy, 'lead');
  assert.equal(add.edges[0].source, 'lead');

  // O autosave de um cliente que ainda não viu o nó novo não pode apagá-lo.
  await api('PUT', `/api/workspaces/${ws.id}/graph`, { nodes: [lead], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  const g = (await api('GET', `/api/workspaces/${ws.id}/graph`)).json;
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1);
  assert.ok((await api('GET', '/api/procs')).json.some((p: any) => p.nodeId === front.id), 'o agente novo está rodando');

  const waited = await mcp.call('tools/call', { name: 'wait_for_agents', arguments: { timeout_seconds: 20 } });
  assert.match(waited.result.content[0].text, /Front fez: monte a tela de login/);

  const sent = await mcp.call('tools/call', { name: 'send_to_agent', arguments: { name: 'front', message: 'agora o cadastro' } });
  assert.equal(sent.result.isError, false);
  const again = await mcp.call('tools/call', { name: 'wait_for_agents', arguments: { names: ['Front'], timeout_seconds: 20 } });
  assert.match(again.result.content[0].text, /Front fez: agora o cadastro/);

  const listed = await mcp.call('tools/call', { name: 'list_agents', arguments: {} });
  assert.match(listed.result.content[0].text, /Líder \(você\)/);

  const bad = await mcp.call('tools/call', { name: 'send_to_agent', arguments: { name: 'Ninguém', message: 'oi' } });
  assert.equal(bad.result.isError, true);

  mcp.close();
  sock.close();
});
