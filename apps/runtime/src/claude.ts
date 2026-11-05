/**
 * Integração com o Claude Code CLI instalado localmente.
 *
 * Usa apenas mecanismos oficiais:
 *  - O binário `claude` é executado num PTY real (modo interativo). Login/logout acontecem
 *    dentro do próprio Claude Code (/login ou `claude auth login`) — o Nexo nunca lê credenciais.
 *  - Sessões: `--session-id <uuid>` para iniciar e `--resume <uuid>` para retomar.
 *  - Estado do agente: hooks oficiais (UserPromptSubmit, Stop, Notification...) injetados
 *    via `--settings <arquivo>`, que notificam o runtime local por HTTP autenticado.
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeNodeData, SystemInfo } from '@nexo/shared';

const exists = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Localiza o executável do Claude Code. Prioriza binário nativo (.exe), sem shell intermediário. */
export function findClaudeCli(): string | null {
  if (process.env.NEXO_CLAUDE_PATH && exists(process.env.NEXO_CLAUDE_PATH)) return process.env.NEXO_CLAUDE_PATH;
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(home, '.local', 'bin', 'claude.exe'));
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  } else {
    candidates.push(path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  }
  for (const c of candidates) if (exists(c)) return c;
  // Fallback: PATH
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true });
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const exe = lines.find((l) => l.toLowerCase().endsWith('.exe')) ?? lines.find((l) => !l.toLowerCase().endsWith('.cmd') && !l.toLowerCase().endsWith('.ps1') && process.platform !== 'win32');
    if (exe) return exe;
    // npm shim no Windows: o .cmd aponta para o binário nativo do pacote.
    const cmd = lines.find((l) => l.toLowerCase().endsWith('.cmd'));
    if (cmd) {
      const native = path.join(path.dirname(cmd), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (exists(native)) return native;
      return cmd;
    }
  } catch {
    /* não encontrado */
  }
  return null;
}

function run(file: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const isCmd = file.toLowerCase().endsWith('.cmd');
    execFile(isCmd ? 'cmd.exe' : file, isCmd ? ['/d', '/c', file, ...args] : args, { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && !stdout) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

let cache: { at: number; value: SystemInfo['claude'] } | null = null;

/** Versão e status de autenticação via `claude --version` e `claude auth status` (oficial). */
export async function claudeStatus(force = false): Promise<SystemInfo['claude']> {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.value;
  const p = findClaudeCli();
  const value: SystemInfo['claude'] = { path: p, version: null, loggedIn: null, authMethod: null, error: null };
  if (!p) {
    value.error = 'Claude Code CLI não encontrado. Instale com: npm i -g @anthropic-ai/claude-code (ou o instalador nativo).';
  } else {
    try {
      value.version = (await run(p, ['--version'])).trim();
    } catch (e) {
      value.error = (e as Error).message;
    }
    try {
      const st = JSON.parse(await run(p, ['auth', 'status']));
      value.loggedIn = !!st.loggedIn;
      value.authMethod = st.authMethod ?? null;
    } catch {
      value.loggedIn = null;
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Diretório onde o Claude Code guarda transcrições (~/.claude/projects/<cwd-codificado>/<sessão>.jsonl). */
export function claudeProjectsDir() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

/** Procura a transcrição de uma sessão — determina se ela pode ser retomada com --resume. */
export function findTranscript(sessionId: string): string | null {
  const base = claudeProjectsDir();
  try {
    for (const d of fs.readdirSync(base)) {
      const f = path.join(base, d, `${sessionId}.jsonl`);
      if (exists(f)) return f;
    }
  } catch {
    /* sem diretório */
  }
  return null;
}

/**
 * Extrai o texto da última resposta do assistente numa transcrição JSONL.
 * Agrupa todos os blocos de texto do último turno (após a última mensagem real do usuário).
 */
export function lastAssistantText(transcriptPath: string): string | null {
  let raw: string;
  try {
    // Lê no máximo os últimos 4 MB.
    const st = fs.statSync(transcriptPath);
    const fd = fs.openSync(transcriptPath, 'r');
    const len = Math.min(st.size, 4 * 1024 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    raw = buf.toString('utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  const texts: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: any;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e.isSidechain) continue;
    if (e.type === 'user') {
      const c = e.message?.content;
      const isToolResult = Array.isArray(c) && c.every((b: any) => b?.type === 'tool_result');
      if (!isToolResult && !e.isMeta) break; // início do turno
      continue;
    }
    if (e.type === 'assistant') {
      const c = e.message?.content;
      if (Array.isArray(c)) {
        const t = c.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n');
        if (t.trim()) texts.unshift(t);
      } else if (typeof c === 'string' && c.trim()) texts.unshift(c);
    }
  }
  return texts.length ? texts.join('\n\n').trim() : null;
}

export interface HookCommand {
  /** Comando que o Claude Code executa para cada hook. */
  command: string;
}

/**
 * Gera o arquivo de settings com hooks do Nexo. É passado por `--settings`, então
 * não altera ~/.claude/settings.json nem os arquivos do projeto do usuário.
 */
export function writeHookSettings(dataDir: string, hook: HookCommand): string {
  const entry = (matcher?: string) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hook.command, timeout: 10 }] }];
  const settings = {
    hooks: {
      SessionStart: entry(),
      UserPromptSubmit: entry(),
      PostToolUse: entry('*'),
      Notification: entry(),
      Stop: entry(),
      SessionEnd: entry(),
    },
  };
  const file = path.join(dataDir, 'hooks', 'nexo-hooks.json');
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return file;
}

/** Instrução para agentes com as ferramentas de equipe do ALt.nexo. */
export const TEAM_PROMPT = [
  'Você está rodando dentro do ALt.nexo, um canvas onde o usuário vê cada agente num terminal próprio.',
  'Quando for dividir o trabalho em frentes paralelas (ex.: frontend, backend, testes), crie agentes com a ferramenta',
  'mcp__nexo__spawn_agent em vez de subagentes internos (Task): assim o usuário acompanha cada um e pode intervir direto.',
  'Use mcp__nexo__wait_for_agents para esperar os resultados, mcp__nexo__send_to_agent para mandar instruções e',
  'mcp__nexo__list_agents para ver quem existe. Para tarefas pequenas, faça você mesmo — não crie agentes à toa.',
].join(' ');

/** Monta os argumentos do Claude Code para um nó. */
export function buildClaudeArgs(d: ClaudeNodeData, opts: { sessionId: string; resume: boolean; settingsFile: string; mcpConfig?: string | null }): string[] {
  const args: string[] = [];
  if (opts.resume) args.push('--resume', opts.sessionId);
  else args.push('--session-id', opts.sessionId);
  args.push('--settings', opts.settingsFile);
  if (opts.mcpConfig) args.push('--mcp-config', opts.mcpConfig);
  if (d.name) args.push('--name', d.name);
  if (d.agent?.trim()) args.push('--agent', d.agent.trim());
  const system = [d.role?.trim(), opts.mcpConfig ? TEAM_PROMPT : ''].filter(Boolean).join('\n\n');
  if (system) args.push('--append-system-prompt', system);
  if (d.permissionMode && d.permissionMode !== 'default') args.push('--permission-mode', d.permissionMode);
  if (d.model?.trim()) args.push('--model', d.model.trim());
  return args;
}

/** Caminho com barras normais — funciona tanto em cmd.exe quanto em Git Bash (usado pelos hooks no Windows). */
export const slash = (p: string) => p.replace(/\\/g, '/');
