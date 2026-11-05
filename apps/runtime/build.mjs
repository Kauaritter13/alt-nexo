import { build } from 'esbuild';
import fs from 'node:fs';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['node-pty'],
  sourcemap: true,
  logLevel: 'info',
  // O código usa import.meta.url apenas como fallback quando __dirname não existe.
  logOverride: { 'empty-import-meta': 'silent' },
};
fs.mkdirSync('dist', { recursive: true });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.cjs' });
await build({ ...common, entryPoints: ['src/server.ts'], outfile: 'dist/runtime.cjs' });
fs.copyFileSync('src/hook.cjs', 'dist/hook.cjs');
fs.copyFileSync('src/mcp.cjs', 'dist/mcp.cjs');
