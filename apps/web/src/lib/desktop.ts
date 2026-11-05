/** Ponte com o Electron (exposta pelo preload). Ausente no navegador. */
export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  pickFolder(defaultPath?: string): Promise<string | null>;
  pickFile(defaultPath?: string): Promise<string | null>;
  openPath(p: string): Promise<string>;
  showItemInFolder(p: string): void;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    nexoDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? (window.nexoDesktop ?? null) : null;
export const isDesktop = !!desktop;

export function openExternal(url: string) {
  if (desktop) void desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
