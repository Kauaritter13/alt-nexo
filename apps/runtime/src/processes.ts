/**
 * Gerenciador de processos: terminais reais (node-pty / ConPTY) e instâncias do Claude Code.
 *
 * Importante: persistência de canvas ≠ persistência de processos. Processos vivem enquanto o
 * runtime estiver aberto. O que sobrevive ao encerramento é: metadados da sessão (SQLite),
 * histórico do terminal (arquivo em logs/) e a conversa do Claude Code (gravada pelo próprio
 * Claude Code, retomável com --resume).
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as pty from 'node-pty';
import type { AgentState, ClaudeNodeData, ProcInfo, SessionRecord, TerminalNodeData } from '@nexo/shared';
import { buildClaudeArgs, findClaudeCli, findTranscript, lastAssistantText } from './claude.js';
import { defaultShell } from './config.js';
import { ensureAgentWorktree } from './git.js';
import { badRequest, notFound, type Repo } from './repo.js';

const LIVE_BUFFER = 512 * 1024; // scrollback em memória por processo
const LOG_MAX = 4 * 1024 * 1024; // log em disco por nó (é truncado para metade ao exceder)
const SCROLLBACK_SEND = 384 * 1024;

interface Proc {
  info: ProcInfo;
  pty: pty.IPty;
  buffer: string;
  log: fs.WriteStream;
  stopping: boolean;
}

export interface ProcessEvents {
  output: [nodeId: string, data: string];
  proc: [info: ProcInfo];
  session: [s: SessionRecord];
  notice: [level: 'info' | 'warn' | 'error', message: string, nodeId?: string];
  /** O agente terminou de responder (hook Stop). */
  agentStop: [nodeId: string, lastMessage: string | null];
  nodePatched: [workspaceId: string, nodeId: string, patch: Record<string, unknown>];
}

export class ProcessManager extends EventEmitter<ProcessEvents> {
  private procs = new Map<string, Proc>();

  constructor(
    private repo: Repo,
    private dataDir: string,
    private hookEnv: { url: string; token: string },
    private hookSettingsFile: string,
    /** Como executar o servidor MCP "nexo" (ferramentas de equipe). */
    private mcp: { command: string; args: string[]; env?: Record<string, string> } | null = null,
  ) {
    super();
  }

  /** Config MCP por nó: o servidor "nexo" sabe qual agente está chamando (NEXO_NODE_ID). */
  private writeMcpConfig(nodeId: string): string | null {
    if (!this.mcp) return null;
    const file = path.join(this.dataDir, 'hooks', `mcp-${nodeId}.json`);
    const env = { ...this.mcp.env, NEXO_URL: this.hookEnv.url, NEXO_HOOK_TOKEN: this.hookEnv.token, NEXO_NODE_ID: nodeId };
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { nexo: { type: 'stdio', command: this.mcp.command, args: this.mcp.args, env } } }, null, 2));
    return file;
  }

  list(workspaceId?: string): ProcInfo[] {
    return [...this.procs.values()].map((p) => p.info).filter((i) => !workspaceId || i.workspaceId === workspaceId);
  }
  get(nodeId: string): ProcInfo | null {
    return this.procs.get(nodeId)?.info ?? null;
  }
  isRunning(nodeId: string) {
    return this.procs.has(nodeId);
  }

  private logPath(nodeId: string) {
    return path.join(this.dataDir, 'logs', `${nodeId}.log`);
  }

  /** Histórico do terminal: buffer vivo, ou o arquivo de log de sessões anteriores. */
  scrollback(nodeId: string): string {
    const p = this.procs.get(nodeId);
    if (p) return p.buffer;
    try {
      const f = this.logPath(nodeId);
      const st = fs.statSync(f);
      const len = Math.min(st.size, SCROLLBACK_SEND);
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch {
      return '';
    }
  }

  clearLog(nodeId: string) {
    fs.rmSync(this.logPath(nodeId), { force: true });
    const p = this.procs.get(nodeId);
    if (p) p.buffer = '';
  }

  private rotateLog(nodeId: string) {
    const f = this.logPath(nodeId);
    try {
      const st = fs.statSync(f);
      if (st.size > LOG_MAX) {
        const keep = LOG_MAX / 2;
        const fd = fs.openSync(f, 'r');
        const buf = Buffer.alloc(keep);
        fs.readSync(fd, buf, 0, keep, st.size - keep);
        fs.closeSync(fd);
        fs.writeFileSync(f, buf);
      }
    } catch {
      /* sem log ainda */
    }
  }

  private baseEnv(nodeId: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    // Não herdar marcadores de outra sessão do Claude Code nem o modo node do Electron.
    // (Se o runtime foi aberto de dentro de um Claude Code, essas variáveis desligariam a gravação de transcrições.)
    const inherited = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|SESSION_.*|MESSAGING_.*|ENTRYPOINT|EXECPATH|SSE_PORT)|ELECTRON_RUN_AS_NODE|NEXO_.*)$/i;
    for (const k of Object.keys(env)) if (inherited.test(k)) delete env[k];
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    env.NEXO_NODE_ID = nodeId;
    env.NEXO_URL = this.hookEnv.url;
    env.NEXO_HOOK_TOKEN = this.hookEnv.token;
    return env;
  }

  async start(nodeId: string, opts: { fresh?: boolean; cols?: number; rows?: number } = {}): Promise<ProcInfo> {
    if (this.procs.has(nodeId)) return this.procs.get(nodeId)!.info;
    const node = this.repo.getNode(nodeId);
    if (!node) throw notFound('Nó');
    if (node.type !== 'claude' && node.type !== 'terminal') throw badRequest('Este nó não executa processos');
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 32;
    let file: string;
    let args: string[];
    let cwd: string;
    let claudeSessionId: string | null = null;
    let resume = false;

    if (node.type === 'terminal') {
      const d = node.data as TerminalNodeData;
      cwd = this.validCwd(d.cwd);
      file = d.shell?.trim() || defaultShell();
      args = /powershell|pwsh/i.test(file) ? ['-NoLogo'] : [];
    } else {
      const d = node.data as ClaudeNodeData;
      const cli = findClaudeCli();
      if (!cli) throw badRequest('Claude Code CLI não encontrado nesta máquina. Instale-o e faça login com `claude` → /login.');
      cwd = this.validCwd(d.cwd);
      if (d.isolate) {
        const wt = d.worktreePath && fs.existsSync(d.worktreePath) ? d.worktreePath : await ensureAgentWorktree(cwd, d.name, nodeId);
        if (wt !== d.worktreePath) {
          this.repo.patchNodeData(nodeId, { worktreePath: wt });
          this.emit('nodePatched', node.workspaceId, nodeId, { worktreePath: wt });
        }
        cwd = wt;
      } else {
        this.warnSharedCwd(nodeId, cwd);
      }
      // Retoma a conversa se o Claude Code tiver a transcrição; senão inicia uma nova com ID conhecido.
      if (!opts.fresh && d.claudeSessionId && findTranscript(d.claudeSessionId)) {
        claudeSessionId = d.claudeSessionId;
        resume = true;
      } else {
        claudeSessionId = randomUUID();
        this.repo.patchNodeData(nodeId, { claudeSessionId });
        this.emit('nodePatched', node.workspaceId, nodeId, { claudeSessionId });
      }
      const mcpConfig = d.team !== false ? this.writeMcpConfig(nodeId) : null;
      args = buildClaudeArgs(d, { sessionId: claudeSessionId, resume, settingsFile: this.hookSettingsFile, mcpConfig });
      file = cli;
      if (file.toLowerCase().endsWith('.cmd')) {
        args = ['/d', '/c', file, ...args];
        file = 'cmd.exe';
      }
    }

    this.rotateLog(nodeId);
    const log = fs.createWriteStream(this.logPath(nodeId), { flags: 'a' });
    const banner = `\r\n\x1b[38;5;240m── ${node.type === 'claude' ? (resume ? 'sessão retomada' : 'nova sessão do Claude Code') : 'terminal iniciado'} · ${new Date().toLocaleString('pt-BR')} · ${cwd} ──\x1b[0m\r\n`;

    let p: pty.IPty;
    try {
      p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env: this.baseEnv(nodeId), useConpty: true });
    } catch (e) {
      log.end();
      throw badRequest(`Falha ao iniciar processo: ${(e as Error).message}`);
    }

    const info: ProcInfo = {
      nodeId,
      workspaceId: node.workspaceId,
      projectId: this.repo.getWorkspace(node.workspaceId).projectId,
      kind: node.type,
      status: 'running',
      agentState: node.type === 'claude' ? 'idle' : 'unknown',
      pid: p.pid,
      startedAt: Date.now(),
      exitCode: null,
      claudeSessionId,
      cwd,
    };
    const proc: Proc = { info, pty: p, buffer: '', log, stopping: false };
    this.procs.set(nodeId, proc);
    this.pushOutput(proc, banner);

    p.onData((data) => this.pushOutput(proc, data));
    p.onExit(({ exitCode }) => {
      this.procs.delete(nodeId);
      proc.info = { ...proc.info, status: 'exited', exitCode, agentState: 'unknown' };
      const tail = `\r\n\x1b[38;5;240m── processo encerrado (código ${exitCode}) ──\x1b[0m\r\n`;
      this.emit('output', nodeId, tail);
      log.end(tail);
      const s = this.repo.upsertSession({
        nodeId,
        status: proc.stopping ? 'stopped' : 'exited',
        agentState: 'unknown',
        endedAt: Date.now(),
        exitCode,
        hasConversation: claudeSessionId ? !!findTranscript(claudeSessionId) : false,
      });
      this.emit('proc', proc.info);
      this.emit('session', s);
      if (node.type === 'claude') this.emit('agentStop', nodeId, null);
    });

    const s = this.repo.upsertSession({
      nodeId,
      workspaceId: node.workspaceId,
      kind: node.type,
      claudeSessionId,
      cwd,
      status: 'running',
      agentState: info.agentState,
      startedAt: info.startedAt,
      endedAt: null,
      exitCode: null,
      lastActivityAt: Date.now(),
      hasConversation: resume,
    });
    this.emit('proc', info);
    this.emit('session', s);
    return info;
  }

  private validCwd(cwd: string | undefined): string {
    const c = cwd?.trim();
    if (!c) throw badRequest('Defina o diretório de trabalho do nó antes de iniciar.');
    if (!fs.existsSync(c) || !fs.statSync(c).isDirectory()) throw badRequest(`Diretório não encontrado: ${c}`);
    return path.resolve(c);
  }

  private warnSharedCwd(nodeId: string, cwd: string) {
    const norm = (p: string) => path.resolve(p).toLowerCase();
    const others = [...this.procs.values()].filter((p) => p.info.kind === 'claude' && p.info.nodeId !== nodeId && norm(p.info.cwd) === norm(cwd));
    if (others.length)
      this.emit(
        'notice',
        'warn',
        `Outro agente já está rodando em ${cwd}. Para evitar que um sobrescreva as alterações do outro, ative "Isolar em git worktree" no agente.`,
        nodeId,
      );
  }

  private pushOutput(proc: Proc, data: string) {
    proc.buffer += data;
    if (proc.buffer.length > LIVE_BUFFER) proc.buffer = proc.buffer.slice(proc.buffer.length - LIVE_BUFFER);
    proc.log.write(data);
    this.emit('output', proc.info.nodeId, data);
  }

  write(nodeId: string, data: string) {
    this.procs.get(nodeId)?.pty.write(data);
  }

  resize(nodeId: string, cols: number, rows: number) {
    const p = this.procs.get(nodeId);
    if (!p || cols < 2 || rows < 2) return;
    try {
      p.pty.resize(Math.floor(cols), Math.floor(rows));
    } catch {
      /* processo encerrando */
    }
  }

  /**
   * Envia um prompt à sessão interativa do Claude Code, como se o usuário tivesse colado o texto
   * e pressionado Enter (bracketed paste preserva quebras de linha).
   */
  async sendPrompt(nodeId: string, text: string) {
    const p = this.procs.get(nodeId);
    if (!p) throw badRequest('O agente não está em execução');
    if (p.info.kind !== 'claude') throw badRequest('Prompts só podem ser enviados a nós do Claude Code');
    p.pty.write(`\x1b[200~${text.replace(/\r\n/g, '\n')}\x1b[201~`);
    await new Promise((r) => setTimeout(r, 250));
    p.pty.write('\r');
  }

  stop(nodeId: string) {
    const p = this.procs.get(nodeId);
    if (!p) return;
    p.stopping = true;
    try {
      p.pty.kill();
    } catch {
      /* já encerrado */
    }
  }

  /** Interrompe o turno atual do agente (Esc no Claude Code), sem encerrar a sessão. */
  interrupt(nodeId: string) {
    this.procs.get(nodeId)?.pty.write('\x1b');
  }

  async restart(nodeId: string, opts: { fresh?: boolean } = {}) {
    const p = this.procs.get(nodeId);
    if (p) {
      const exited = new Promise<void>((resolve) => {
        const onProc = (i: ProcInfo) => {
          if (i.nodeId === nodeId && i.status === 'exited') {
            this.off('proc', onProc);
            resolve();
          }
        };
        this.on('proc', onProc);
        setTimeout(resolve, 5000);
      });
      this.stop(nodeId);
      await exited;
    }
    return this.start(nodeId, { fresh: opts.fresh });
  }

  stopAll() {
    for (const id of [...this.procs.keys()]) this.stop(id);
  }

  setAgentState(nodeId: string, state: AgentState) {
    const p = this.procs.get(nodeId);
    if (!p || p.info.agentState === state) return;
    p.info = { ...p.info, agentState: state };
    this.emit('proc', p.info);
  }

  /** Eventos dos hooks oficiais do Claude Code. */
  handleHook(nodeId: string, payload: any) {
    const p = this.procs.get(nodeId);
    const ev = String(payload?.hook_event_name ?? '');
    const now = Date.now();
    switch (ev) {
      case 'UserPromptSubmit':
      case 'PostToolUse':
        this.setAgentState(nodeId, 'working');
        this.emit('session', this.repo.upsertSession({ nodeId, agentState: 'working', lastActivityAt: now, hasConversation: true }));
        break;
      case 'Notification':
        // "idle_prompt" só indica que o agente está ocioso há algum tempo — não é pedido de ação.
        if (payload?.notification_type === 'idle_prompt' || /waiting for your input/i.test(String(payload?.message ?? ''))) break;
        this.setAgentState(nodeId, 'waiting');
        this.emit('session', this.repo.upsertSession({ nodeId, agentState: 'waiting', lastActivityAt: now }));
        if (payload?.message) this.emit('notice', 'info', String(payload.message), nodeId);
        break;
      case 'Stop': {
        this.setAgentState(nodeId, 'idle');
        const msg =
          (typeof payload?.last_assistant_message === 'string' && payload.last_assistant_message) ||
          (payload?.transcript_path ? lastAssistantText(payload.transcript_path) : null);
        this.emit('session', this.repo.upsertSession({ nodeId, agentState: 'idle', lastMessage: msg, lastActivityAt: now, hasConversation: true }));
        this.emit('agentStop', nodeId, msg);
        break;
      }
      case 'SessionStart':
        if (p && payload?.session_id && payload.session_id !== p.info.claudeSessionId) {
          // /clear ou troca de sessão dentro do Claude Code: acompanha o novo ID para retomadas futuras.
          p.info = { ...p.info, claudeSessionId: payload.session_id };
          this.repo.patchNodeData(nodeId, { claudeSessionId: payload.session_id });
          this.emit('nodePatched', p.info.workspaceId, nodeId, { claudeSessionId: payload.session_id });
          this.emit('session', this.repo.upsertSession({ nodeId, claudeSessionId: payload.session_id }));
          this.emit('proc', p.info);
        }
        break;
      default:
        break;
    }
  }
}
