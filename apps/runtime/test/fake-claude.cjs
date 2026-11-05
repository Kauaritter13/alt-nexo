// Claude Code falso para testes: anuncia SessionStart pelos hooks e responde cada prompt com Stop.
const http = require('node:http');
const args = process.argv.slice(2);
const sid = args[args.indexOf('--session-id') + 1];
const name = args.includes('--name') ? args[args.indexOf('--name') + 1] : '?';

function hook(payload) {
  const body = JSON.stringify({ nodeId: process.env.NEXO_NODE_ID, payload });
  const u = new URL('/api/hooks/claude', process.env.NEXO_URL);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'x-nexo-hook-token': process.env.NEXO_HOOK_TOKEN } });
  req.on('error', () => {});
  req.end(body);
}

process.stdout.write(`fake claude ${name} ${args.includes('--mcp-config') ? 'com equipe' : 'sem equipe'}\r\n`);
setTimeout(() => hook({ hook_event_name: 'SessionStart', session_id: sid }), 200);

let buf = '';
// Como a TUI real: modo bruto, recebe as sequências de bracketed paste intactas.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  if (!buf.includes('\r')) return;
  // O ConPTY pode entregar o paste com ou sem os marcadores \x1b[200~ … \x1b[201~.
  const text = buf.replace(/\x1b\[[0-9;?]*[~A-Za-z]/g, '').replace(/\r/g, '').trim();
  buf = '';
  if (!text) return;
  process.stdout.write(`recebi: ${text}\r\n`);
  hook({ hook_event_name: 'UserPromptSubmit' });
  setTimeout(() => hook({ hook_event_name: 'Stop', last_assistant_message: `${name} fez: ${text.split('\n').pop()}` }), 400);
});
