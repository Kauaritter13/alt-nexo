/**
 * Instâncias xterm.js por nó, independentes do ciclo de vida dos componentes React.
 * O elemento do terminal é movido entre o nó do canvas e a visão maximizada sem perder estado.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ServerMsg } from '@nexo/shared';
import { socket } from '@/lib/ws';
import { openExternal } from '@/lib/desktop';

interface Entry {
  term: Terminal;
  fit: FitAddon;
  el: HTMLDivElement;
  opened: boolean;
  lastSize: { cols: number; rows: number } | null;
  resizeTimer?: number;
}

const entries = new Map<string, Entry>();

/** Paleta ALt. no terminal (sempre escuro): fundo n0, tinta creme, cursor limão. */
const THEME = {
  background: '#0c0d0b',
  foreground: '#f3efe0',
  cursor: '#c9f24c',
  cursorAccent: '#0c0d0b',
  selectionBackground: '#c9f24c40',
  black: '#1b1c17',
  red: '#f2685f',
  green: '#3fb984',
  yellow: '#e0a83c',
  blue: '#6ea8fe',
  magenta: '#b892f2',
  cyan: '#4fd1c5',
  white: '#d9d5c5',
  brightBlack: '#8f8c7c',
  brightRed: '#f68c85',
  brightGreen: '#6fd3a5',
  brightYellow: '#ecc26f',
  brightBlue: '#9cc4fe',
  brightMagenta: '#cfb4f7',
  brightCyan: '#7fe0d7',
  brightWhite: '#f3efe0',
};

function create(nodeId: string): Entry {
  const term = new Terminal({
    fontFamily: "'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace",
    fontSize: 12.5,
    lineHeight: 1.15,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 10000,
    theme: THEME,
    macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => openExternal(uri)));
  term.onData((data) => socket.send({ t: 'input', nodeId, data }));
  term.onBinary((data) => socket.send({ t: 'input', nodeId, data }));
  // Ctrl+C copia quando há seleção; Ctrl+V cola (Windows).
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && e.key === 'v') {
      void navigator.clipboard.readText().then((t) => t && term.paste(t));
      return false;
    }
    return true;
  });
  const el = document.createElement('div');
  el.className = 'nexo-term h-full w-full';
  const entry: Entry = { term, fit, el, opened: false, lastSize: null };
  entries.set(nodeId, entry);
  socket.send({ t: 'attach', nodeId });
  return entry;
}

export function getTerminal(nodeId: string): Entry {
  return entries.get(nodeId) ?? create(nodeId);
}

/** Monta o terminal num container (move o elemento se já estiver em outro lugar). */
export function mountTerminal(nodeId: string, container: HTMLElement) {
  const e = getTerminal(nodeId);
  if (e.el.parentElement !== container) container.appendChild(e.el);
  if (!e.opened) {
    e.term.open(e.el);
    e.opened = true;
  }
  fitTerminal(nodeId);
}

export function fitTerminal(nodeId: string) {
  const e = entries.get(nodeId);
  if (!e || !e.opened || !e.el.isConnected || e.el.clientWidth < 20 || e.el.clientHeight < 20) return;
  try {
    e.fit.fit();
  } catch {
    return;
  }
  const { cols, rows } = e.term;
  if (e.lastSize?.cols === cols && e.lastSize?.rows === rows) return;
  e.lastSize = { cols, rows };
  clearTimeout(e.resizeTimer);
  e.resizeTimer = window.setTimeout(() => socket.send({ t: 'resize', nodeId, cols, rows }), 80);
}

export function terminalSize(nodeId: string) {
  const e = entries.get(nodeId);
  return e?.opened ? { cols: e.term.cols, rows: e.term.rows } : { cols: 120, rows: 32 };
}

export function focusTerminal(nodeId: string) {
  entries.get(nodeId)?.term.focus();
}

export function clearTerminal(nodeId: string) {
  entries.get(nodeId)?.term.reset();
}

export function disposeTerminal(nodeId: string) {
  const e = entries.get(nodeId);
  if (!e) return;
  socket.send({ t: 'detach', nodeId });
  e.term.dispose();
  e.el.remove();
  entries.delete(nodeId);
}

export function disposeAllTerminals() {
  for (const id of [...entries.keys()]) disposeTerminal(id);
}

socket.on((m: ServerMsg) => {
  if (m.t === 'output') entries.get(m.nodeId)?.term.write(m.data);
  else if (m.t === 'proc' && m.proc.status === 'running') {
    // Processo (re)iniciado — possivelmente pelo orquestrador, com tamanho padrão: reenvia o tamanho real.
    const e = entries.get(m.proc.nodeId);
    if (e?.opened) {
      e.lastSize = null;
      fitTerminal(m.proc.nodeId);
      if (!e.lastSize) socket.send({ t: 'resize', nodeId: m.proc.nodeId, cols: e.term.cols, rows: e.term.rows });
    }
  }
  else if (m.t === 'scrollback') {
    const e = entries.get(m.nodeId);
    if (!e) return;
    e.term.reset();
    if (m.data) e.term.write(m.data);
  }
});

// Ao reconectar o WebSocket, reassina todos os terminais (o servidor reenvia o histórico).
socket.onStatus((connected) => {
  if (connected) for (const id of entries.keys()) socket.send({ t: 'attach', nodeId: id });
});
