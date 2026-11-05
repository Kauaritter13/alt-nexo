import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tema claro/escuro no padrão do ALt.: escuro é o padrão, claro é escolha explícita salva no
 * navegador. A verdade em runtime é o `data-theme` do <html>.
 */
export type Theme = 'dark' | 'light';

const KEY = 'alt.nexo.theme';
const EVENT = 'alt-nexo:theme-change';

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* sem persistência: vale só nesta aba */
  }
  window.dispatchEvent(new Event(EVENT));
}

const current = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== KEY) return;
    applyTheme(getStoredTheme());
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'dark' as Theme);
  const toggle = useCallback(() => setTheme(current() === 'light' ? 'dark' : 'light'), []);
  return { theme, toggle };
}
