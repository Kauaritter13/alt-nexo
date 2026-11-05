import { create } from 'zustand';

export type SidebarTab = 'elements' | 'map' | 'files' | 'git' | 'runs';

interface UIState {
  runDialogNodeId: string | null;
  openRunDialog: (nodeId: string) => void;
  closeRunDialog: () => void;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  setSidebarTab: (t: SidebarTab) => void;
  toggleSidebar: () => void;
  inspectorOpen: boolean;
  toggleInspector: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('nexo.ui') ?? '{}');
  } catch {
    return {};
  }
})();

export const useUI = create<UIState>((set, get) => ({
  runDialogNodeId: null,
  // adiado: abrir um Dialog no mesmo tick em que um menu fecha faz o Radix fechá-lo imediatamente
  openRunDialog: (runDialogNodeId) => void setTimeout(() => set({ runDialogNodeId }), 0),
  closeRunDialog: () => set({ runDialogNodeId: null }),
  sidebarTab: saved.sidebarTab ?? 'elements',
  sidebarOpen: saved.sidebarOpen ?? true,
  setSidebarTab: (sidebarTab) => set({ sidebarTab, sidebarOpen: true }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  inspectorOpen: saved.inspectorOpen ?? true,
  toggleInspector: () => set({ inspectorOpen: !get().inspectorOpen }),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));

useUI.subscribe((s) => localStorage.setItem('nexo.ui', JSON.stringify({ sidebarTab: s.sidebarTab, sidebarOpen: s.sidebarOpen, inspectorOpen: s.inspectorOpen })));
