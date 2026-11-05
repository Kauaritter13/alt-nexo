import { build } from 'esbuild';
import fs from 'node:fs';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'node-pty'],
  sourcemap: true,
  logLevel: 'info',
  logOverride: { 'empty-import-meta': 'silent' },
};

fs.mkdirSync('dist', { recursive: true });
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });
// O hook do Claude Code e o ícone vão junto do main.
fs.copyFileSync('../runtime/src/hook.cjs', 'dist/hook.cjs');
fs.copyFileSync('../runtime/src/mcp.cjs', 'dist/mcp.cjs');
if (fs.existsSync('build/icon.png')) fs.copyFileSync('build/icon.png', 'dist/icon.png');
