import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const VERSION = '0.1.0';

/** Diretório de dados do ALt.nexo (banco, logs de terminal, backups, configs de hooks). */
export function resolveDataDir(explicit?: string): string {
  const dir =
    explicit ||
    process.env.NEXO_DATA_DIR ||
    (process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ALt.nexo')
      : path.join(os.homedir(), '.alt-nexo'));
  for (const sub of ['', 'logs', 'backups', 'hooks']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}

export function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}
