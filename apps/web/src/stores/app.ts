import { create } from 'zustand';
import type { Folder, ProcInfo, ProjectSummary, Run, ServerMsg, SessionRecord, SystemInfo } from '@nexo/shared';
import { toast } from 'sonner';
import { api, ApiError, getToken, initToken, setDeviceToken } from '@/lib/api';
import { socket } from '@/lib/ws';

export type AuthState = 'checking' | 'offline' | 'unpaired' | 'ready';

interface AppState {
  auth: AuthState;
  authError: string | null;
  connected: boolean;
  system: SystemInfo | null;
  folders: Folder[];
  projects: ProjectSummary[];
  procs: Record<string, ProcInfo>;
  sessions: Record<string, SessionRecord>;
  runs: Run[];

  boot: () => Promise<void>;
  pair: (codeOrUrl: string) => Promise<void>;
  logout: () => void;
  refreshSystem: (force?: boolean) => Promise<void>;
  refreshProjects: () => Promise<void>;
  loadRuntime: (workspaceId: string) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  auth: 'checking',
  authError: null,
  connected: false,
  system: null,
  folders: [],
  projects: [],
  procs: {},
  sessions: {},
  runs: [],

  boot: async () => {
    const { pairCode } = initToken();
    try {
      await api.health();
    } catch {
      set({ auth: 'offline' });
      setTimeout(() => get().boot(), 3000);
      return;
    }
    if (pairCode && !getToken()) {
      try {
        const { token } = await api.pair(pairCode);
        setDeviceToken(token);
      } catch (e) {
        set({ authError: (e as Error).message });
      }
    }
    if (!getToken()) return set({ auth: 'unpaired' });
    try {
      await Promise.all([get().refreshSystem(), get().refreshProjects()]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setDeviceToken(null);
        return set({ auth: 'unpaired', authError: 'Token expirado ou revogado. Pareie novamente.' });
      }
      set({ auth: 'offline' });
      return;
    }
    socket.connect();
    api
      .procs()
      .then((all) => set({ procs: Object.fromEntries(all.map((p) => [p.nodeId, p])) }))
      .catch(() => {});
    set({ auth: 'ready' });
  },

  pair: async (input) => {
    let code = input.trim();
    try {
      const u = new URL(code);
      code = u.searchParams.get('pair') ?? code;
    } catch {
      /* não é URL: é o código */
    }
    const { token } = await api.pair(code);
    setDeviceToken(token);
    set({ authError: null });
    await get().boot();
  },

  logout: () => {
    setDeviceToken(null);
    socket.disconnect();
    set({ auth: 'unpaired' });
  },

  refreshSystem: async (force = false) => set({ system: await api.system(force) }),

  refreshProjects: async () => {
    const [folders, projects] = await Promise.all([api.folders(), api.projects()]);
    set({ folders, projects });
  },

  loadRuntime: async (workspaceId) => {
    // Processos de todos os projetos (as abas mostram quem está trabalhando em cada um).
    const [r, all] = await Promise.all([api.runtime(workspaceId), api.procs()]);
    set({
      procs: Object.fromEntries(all.map((p) => [p.nodeId, p])),
      sessions: Object.fromEntries(r.sessions.map((s) => [s.nodeId, s])),
      runs: r.runs,
    });
  },
}));

socket.onStatus((connected) => useApp.setState({ connected }));

socket.on((m: ServerMsg) => {
  switch (m.t) {
    case 'proc':
      useApp.setState((s) => {
        const procs = { ...s.procs };
        if (m.proc.status === 'exited') delete procs[m.proc.nodeId];
        else procs[m.proc.nodeId] = m.proc;
        return { procs };
      });
      break;
    case 'session':
      useApp.setState((s) => ({ sessions: { ...s.sessions, [m.session.nodeId]: m.session } }));
      break;
    case 'run':
      useApp.setState((s) => {
        const others = s.runs.filter((r) => r.id !== m.run.id);
        return { runs: [m.run, ...others].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50) };
      });
      if (m.run.status === 'done') toast.success('Fluxo concluído');
      if (m.run.status === 'failed') toast.error(`Fluxo falhou: ${m.run.error}`);
      break;
    case 'notice':
      (m.level === 'error' ? toast.error : m.level === 'warn' ? toast.warning : toast.info)(m.message);
      break;
  }
});
