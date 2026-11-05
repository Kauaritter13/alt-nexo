#!/usr/bin/env node
/**
 * Servidor MCP "nexo" (stdio, JSON-RPC por linha) — ferramentas de equipe do ALt.nexo.
 * O Claude Code o inicia via --mcp-config; cada chamada é repassada ao runtime local,
 * que cria/coordena agentes visíveis no canvas. Sem dependências.
 */
const http = require('node:http');

const url = process.env.NEXO_URL;
const token = process.env.NEXO_HOOK_TOKEN;
const nodeId = process.env.NEXO_NODE_ID;

const TOOLS = [
  {
    name: 'spawn_agent',
    description:
      'Cria um novo agente do Claude Code no canvas do ALt.nexo, com terminal próprio que o usuário acompanha e onde pode intervir. Use para frentes de trabalho paralelas (ex.: "Front", "Back", "Testes"). O agente começa imediatamente com o prompt dado.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome curto e claro, ex.: "Front", "Back", "Testes".' },
        prompt: { type: 'string', description: 'Tarefa inicial completa e autossuficiente (o agente não vê a sua conversa).' },
        role: { type: 'string', description: 'Função/limites permanentes do agente (system prompt), ex.: "Só altere arquivos em web/".' },
        cwd: { type: 'string', description: 'Diretório de trabalho, relativo ao seu (ex.: "web") ou absoluto. Padrão: o seu.' },
        model: { type: 'string', description: 'opus, sonnet ou haiku. Padrão: o seu.' },
        agent: { type: 'string', description: 'Nome de um subagente em <cwd>/.claude/agents para o agente assumir.' },
        isolate: { type: 'boolean', description: 'Rodar num git worktree próprio para não conflitar com outros agentes.' },
      },
      required: ['name', 'prompt'],
    },
  },
  {
    name: 'list_agents',
    description: 'Lista os agentes do canvas atual com estado (trabalhando, livre, aguardando o usuário) e a última resposta de cada um.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_to_agent',
    description: 'Envia uma mensagem/instrução a outro agente do canvas (espera ele terminar o turno atual antes de enviar).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, message: { type: 'string' } },
      required: ['name', 'message'],
    },
  },
  {
    name: 'wait_for_agents',
    description: 'Espera os agentes indicados terminarem o turno atual e devolve a resposta final de cada um. Sem "names", espera os agentes que você criou.',
    inputSchema: {
      type: 'object',
      properties: { names: { type: 'array', items: { type: 'string' } }, timeout_seconds: { type: 'number', description: 'Padrão 900.' } },
    },
  },
  {
    name: 'read_agent',
    description: 'Lê a última resposta de um agente sem esperar.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

function post(tool, args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ nodeId, args });
    const u = new URL(`/api/team/${tool}`, url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'x-nexo-hook-token': token, 'content-length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let j = {};
          try {
            j = JSON.parse(data);
          } catch {
            /* resposta inválida */
          }
          if (res.statusCode === 200) resolve({ ok: true, text: String(j.text ?? '') });
          else resolve({ ok: false, text: String(j.error ?? `Erro ${res.statusCode}`) });
        });
      },
    );
    req.on('error', (e) => resolve({ ok: false, text: `ALt.nexo indisponível: ${e.message}` }));
    req.end(body);
  });
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notificação
  switch (method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0',
        id,
        result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'nexo', version: '0.1.0' } },
      });
    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    case 'tools/call': {
      if (!url || !token || !nodeId) return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Fora do ALt.nexo: ferramentas indisponíveis.' }], isError: true } });
      const r = await post(params?.name, params?.arguments ?? {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }], isError: !r.ok } });
    }
    default:
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método não suportado: ${method}` } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    void handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
