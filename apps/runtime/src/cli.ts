/**
 * Runtime standalone (modo navegador): `npm start` ou `npm run dev:runtime`.
 * Flags: --port <n>  --data <dir>  --static <dir>  --dev
 */
import path from 'node:path';
import fs from 'node:fs';
import { startRuntime } from './server.js';

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dev = argv.includes('--dev');

const here = typeof __dirname !== 'undefined' ? __dirname : path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const defaultStatic = [path.join(here, 'web'), path.join(here, '..', '..', 'web', 'dist')].find((d) => fs.existsSync(path.join(d, 'index.html')));

async function main() {
const rt = await startRuntime({
  port: Number(flag('port') ?? process.env.NEXO_PORT ?? 7420),
  dataDir: flag('data'),
  staticDir: flag('static') ?? (dev ? undefined : defaultStatic),
});

const uiUrl = dev ? rt.pairingUrl.replace(rt.url, 'http://127.0.0.1:5173') : rt.pairingUrl;
console.log(`\n  Abra para parear este navegador (link válido enquanto o runtime estiver aberto):\n  \x1b[36m${uiUrl}\x1b[0m\n`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  console.log('\n[nexo] encerrando processos e salvando estado...');
  await rt.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[ALt.nexo] falha ao iniciar:', e?.message ?? e);
  process.exit(1);
});
