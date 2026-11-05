#!/usr/bin/env node
/**
 * Hook do Claude Code → runtime do Nexo.
 * Executado pelo Claude Code (configurado via --settings). Lê o JSON do evento em stdin
 * e encaminha ao runtime local. Nunca bloqueia nem falha o Claude: sempre sai com código 0.
 */
const http = require('node:http');

const url = process.env.NEXO_URL;
const token = process.env.NEXO_HOOK_TOKEN;
const nodeId = process.env.NEXO_NODE_ID;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', send);
setTimeout(send, 3000); // stdin não fechou: envia o que tiver

let sent = false;
function send() {
  if (sent) return;
  sent = true;
  if (!url || !token || !nodeId) return process.exit(0);
  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    payload = {};
  }
  const body = JSON.stringify({ nodeId, payload });
  try {
    const u = new URL('/api/hooks/claude', url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: 4000, headers: { 'content-type': 'application/json', 'x-nexo-hook-token': token, 'content-length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => process.exit(0));
      },
    );
    req.on('error', () => process.exit(0));
    req.on('timeout', () => {
      req.destroy();
      process.exit(0);
    });
    req.end(body);
  } catch {
    process.exit(0);
  }
}
