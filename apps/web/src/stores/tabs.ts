/**
 * Abas de projetos (como no navegador): vários projetos abertos, alternando sem parar nada —
 * os processos vivem no runtime, a aba só troca o canvas exibido.
 */
import { create } from 'zustand';
import type { ServerMsg } from '@nexo/shared';
import { socket } from '@/lib/ws';

interface TabsState {
  open: string[];
  /** Último workspace visto em cada projeto. */
  lastWs: Record<string, string>;
  /** Projetos com novidade não vista (ex.: um agente criou outro enquanto você estava em outra aba). */
  unseen: Record<string, boolean>;
  current: string | null;
  visit: (projectId: string | null, workspaceId?: string) => void;
  close: (projectId: string) => string | null;
  move: (from: string, to: string) => void;
}

const KEY = 'nexo.tabs';
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
})();

export const useTabs = create<TabsState>((set, get) => ({
  open: Array.isArray(saved.open) ? saved.open : [],
  lastWs: saved.lastWs ?? {},
  unseen: {},
  current: null,
  visit: (projectId, workspaceId) => {
    if (!projectId) return set({ current: null });
    const s = get();
    set({
      current: projectId,
      open: s.open.includes(projectId) ? s.open : [...s.open, projectId],
      lastWs: workspaceId ? { ...s.lastWs, [projectId]: workspaceId } : s.lastWs,
      unseen: { ...s.unseen, [projectId]: false },
    });
  },
  /** Fecha a aba e devolve o projeto vizinho para abrir (ou null = início). */
  close: (projectId) => {
    const s = get();
    const i = s.open.indexOf(projectId);
    const open = s.open.filter((id) => id !== projectId);
    set({ open });
    if (s.current !== projectId) return s.current;
    return open[Math.min(i, open.length - 1)] ?? null;
  },
  move: (from, to) => {
    const open = [...get().open];
    const a = open.indexOf(from);
    const b = open.indexOf(to);
    if (a < 0 || b < 0 || a === b) return;
    open.splice(b, 0, open.splice(a, 1)[0]);
    set({ open });
  },
}));

useTabs.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ open: s.open, lastWs: s.lastWs }));
  } catch {
    /* sem armazenamento */
  }
});

socket.on((m: ServerMsg) => {
  if (m.t !== 'graphAdd') return;
  const s = useTabs.getState();
  if (s.current === m.projectId) return;
  useTabs.setState({ unseen: { ...s.unseen, [m.projectId]: true }, open: s.open.includes(m.projectId) ? s.open : [...s.open, m.projectId] });
});
