/**
 * Acesso a arquivos com autorização:
 *  - Listar diretórios (apenas nomes) é permitido para escolher pastas.
 *  - Ler/escrever conteúdo só dentro de raízes autorizadas: diretórios dos projetos,
 *    diretórios de trabalho dos nós e pastas liberadas explicitamente em Configurações.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FsEntry } from '@nexo/shared';
import { badRequest, HttpError, type Repo } from './repo.js';
import { claudeMemoryDir } from './scan.js';

const MAX_READ = 2 * 1024 * 1024;
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'target', '.turbo']);

export class FileService {
  constructor(private repo: Repo) {}

  roots(): string[] {
    const set = new Set<string>();
    const db = this.repo.db;
    for (const r of db.prepare('SELECT root_path FROM projects WHERE root_path IS NOT NULL').all() as any[]) {
      set.add(path.resolve(r.root_path));
      // A memória do Claude Code daquela pasta faz parte do "cérebro" do projeto.
      set.add(claudeMemoryDir(r.root_path));
    }
    for (const r of db.prepare("SELECT json_extract(data,'$.cwd') AS cwd, json_extract(data,'$.worktreePath') AS wt FROM nodes WHERE type IN ('claude','terminal')").all() as any[]) {
      if (r.cwd) set.add(path.resolve(r.cwd));
      if (r.wt) set.add(path.resolve(r.wt));
    }
    for (const r of this.repo.getSetting<string[]>('allowedRoots', [])) set.add(path.resolve(r));
    return [...set];
  }

  isAuthorized(p: string): boolean {
    const abs = path.resolve(p).toLowerCase();
    return this.roots().some((r) => {
      const root = r.toLowerCase();
      return abs === root || abs.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
    });
  }

  private assertAuthorized(p: string) {
    if (!this.isAuthorized(p))
      throw new HttpError(403, `Acesso negado: ${p} está fora das pastas autorizadas. Vincule a pasta a um projeto ou libere-a em Configurações.`);
  }

  home() {
    return os.homedir();
  }

  drives(): string[] {
    if (process.platform !== 'win32') return ['/'];
    const out: string[] = [];
    for (let c = 67; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:\\`;
      try {
        fs.accessSync(d);
        out.push(d);
      } catch {
        /* ausente */
      }
    }
    return out;
  }

  list(dir: string, opts: { showHidden?: boolean } = {}): FsEntry[] {
    const abs = path.resolve(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      throw badRequest(`Não foi possível listar ${abs}: ${(e as Error).message}`);
    }
    const out: FsEntry[] = [];
    for (const e of entries) {
      if (!opts.showHidden && (e.name.startsWith('.') || IGNORED.has(e.name))) continue;
      const p = path.join(abs, e.name);
      let size = 0;
      let mtime = 0;
      try {
        const st = fs.statSync(p);
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        continue;
      }
      out.push({ name: e.name, path: p, dir: e.isDirectory(), size, mtime });
    }
    return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  }

  read(p: string): { path: string; content: string; size: number; binary: boolean; truncated: boolean } {
    this.assertAuthorized(p);
    const abs = path.resolve(p);
    const st = fs.statSync(abs);
    if (st.isDirectory()) throw badRequest('É um diretório');
    const len = Math.min(st.size, MAX_READ);
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    const binary = buf.subarray(0, 8000).includes(0);
    return { path: abs, content: binary ? '' : buf.toString('utf8'), size: st.size, binary, truncated: st.size > MAX_READ };
  }

  write(p: string, content: string) {
    this.assertAuthorized(p);
    const abs = path.resolve(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Escrita atômica: arquivo temporário + rename.
    const tmp = `${abs}.nexo-tmp-${process.pid}`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, abs);
  }

  mkdir(p: string) {
    fs.mkdirSync(path.resolve(p), { recursive: true });
  }
}
