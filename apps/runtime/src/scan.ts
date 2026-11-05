/**
 * Leitura de uma pasta: identifica o que é agente (.claude/agents, skills, comandos, MCP),
 * o que é cérebro (CLAUDE.md, cofres Obsidian, memória, docs) e o que é arquivo (stack, tipos, subprojetos).
 * Só lê metadados pequenos (frontmatter, package.json); nada é escrito na pasta.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrainKind, FolderScan, ScanAgent, ScanBrain } from '@nexo/shared';
import { badRequest } from './repo.js';

const MAX_FILES = 40_000;
const MAX_DEPTH = 8;
const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'target', '.turbo', 'coverage', '.cache', 'vendor', 'release', 'win-unpacked', '__MACOSX']);
const INSTRUCTION_FILES = new Set(['claude.md', 'claude.local.md', 'agents.md']);
const BRAIN_DIR = /(vault|c[ée]rebro|brain|knowledge|wiki|obsidian|notas|notes)/i;
const DOCS_DIR = /^(docs?|documenta[cç][aã]o)$/i;
const ENTRY = /^(home|index|readme|00[\s_-]?.*|_?inicio|início|mapa|moc.*)\.md$/i;

const KIND: [string, RegExp][] = [
  ['Código', /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|php|rb|vue|svelte|astro|c|cpp|h|swift|dart|sql|sh|ps1|lua)$/i],
  ['Notas e docs', /\.(md|mdx|txt|pdf|docx?|odt|rtf)$/i],
  ['Dados e config', /\.(json|ya?ml|toml|csv|tsv|xlsx?|xml|ini|env|lock)$/i],
  ['Web e estilo', /\.(html?|css|scss|sass|less)$/i],
  ['Imagens e mídia', /\.(png|jpe?g|gif|svg|webp|ico|avif|mp4|webm|mov|mp3|wav|ogg)$/i],
];

export function scanFolder(root: string): FolderScan {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw badRequest(`Pasta não encontrada: ${abs}`);

  const agents: ScanAgent[] = [];
  const skills: ScanAgent[] = [];
  const commands: ScanAgent[] = [];
  const brain: ScanBrain[] = [];
  const kinds = new Map<string, number>();
  const subprojects: FolderScan['files']['subprojects'] = [];
  let total = 0;
  let dirs = 0;
  let truncated = false;
  /** Pastas já classificadas como cérebro: os .md dentro delas não viram itens separados. */
  const brainDirs: string[] = [];
  const insideBrain = (p: string) => brainDirs.some((d) => p.startsWith(d + path.sep));

  const walk = (dir: string, depth: number) => {
    if (truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirs++;
    const names = new Set(entries.map((e) => e.name.toLowerCase()));

    if (names.has('.claude')) readClaudeDir(path.join(dir, '.claude'), dir, { agents, skills, commands });
    if (dir !== abs && depth <= 3 && (names.has('package.json') || names.has('pyproject.toml') || names.has('go.mod') || names.has('cargo.toml') || names.has('.git')))
      subprojects.push({ name: path.relative(abs, dir), path: dir, stack: detectStack(dir, names) });

    // Cérebro em pasta: cofre Obsidian, memória, pasta de conhecimento ou docs.
    if (!insideBrain(dir)) {
      const base = path.basename(dir);
      let kind: BrainKind | null = null;
      if (names.has('.obsidian')) kind = 'vault';
      else if (names.has('memory.md')) kind = 'memory';
      else if (dir !== abs && BRAIN_DIR.test(base)) kind = 'vault';
      else if (dir !== abs && DOCS_DIR.test(base)) kind = 'docs';
      if (kind) {
        const md = countMarkdown(dir);
        if (kind === 'vault' && !names.has('.obsidian') && md.count < 3) kind = null;
        else if (kind === 'docs' && md.count < 2) kind = null;
        if (kind) {
          brainDirs.push(dir);
          brain.push({ kind, name: path.relative(abs, dir) || path.basename(dir), path: dir, entry: md.entry, notes: md.count });
        }
      }
    }

    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || IGNORED.has(e.name) || depth >= MAX_DEPTH) continue;
        walk(p, depth + 1);
      } else if (e.isFile()) {
        if (++total > MAX_FILES) {
          truncated = true;
          return;
        }
        const k = KIND.find(([, re]) => re.test(e.name))?.[0] ?? 'Outros';
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        if (INSTRUCTION_FILES.has(e.name.toLowerCase()) && !insideBrain(p))
          brain.push({ kind: 'instructions', name: path.relative(abs, p), path: p, entry: p, notes: 1 });
      }
    }
  };
  walk(abs, 0);

  // Memória do Claude Code para esta pasta (~/.claude/projects/<pasta>/memory).
  const mem = claudeMemoryDir(abs);
  if (fs.existsSync(path.join(mem, 'MEMORY.md'))) brain.push({ kind: 'memory', name: 'Memória do Claude Code', path: mem, entry: path.join(mem, 'MEMORY.md'), notes: countMarkdown(mem).count });

  const rootNames = new Set(safeList(abs).map((n) => n.toLowerCase()));
  const readme = safeList(abs).find((n) => /^readme\.md$/i.test(n));
  // Ordem: instruções da raiz, cofres e memória, instruções de subpastas, docs — e dentro disso, o mais raso primeiro.
  const depthOf = (p: string) => p.split(/[\\/]/).length;
  const rootDepth = depthOf(abs);
  const rank = (b: ScanBrain) =>
    b.kind === 'instructions' ? (depthOf(b.path) - rootDepth <= 1 ? 0 : 2) : b.kind === 'docs' ? 3 : b.kind === 'vault' && b.notes < 10 ? 2 : 1;
  brain.sort((a, b) => rank(a) - rank(b) || depthOf(a.path) - depthOf(b.path) || b.notes - a.notes);

  return {
    root: abs,
    name: path.basename(abs) || abs,
    agents: dedupe(agents),
    skills: dedupe(skills),
    commands: dedupe(commands),
    brain,
    mcp: readMcp(abs),
    files: {
      total: Math.min(total, MAX_FILES),
      dirs,
      byKind: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      stack: detectStack(abs, rootNames),
      subprojects: subprojects.slice(0, 30),
      readme: readme ? path.join(abs, readme) : null,
      git: rootNames.has('.git'),
      truncated,
    },
    scannedAt: Date.now(),
  };
}

/** Pasta de memória que o Claude Code usa para um diretório de trabalho. */
export function claudeMemoryDir(dir: string): string {
  return path.join(os.homedir(), '.claude', 'projects', path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-'), 'memory');
}

function readClaudeDir(claudeDir: string, home: string, out: { agents: ScanAgent[]; skills: ScanAgent[]; commands: ScanAgent[] }) {
  for (const f of safeList(path.join(claudeDir, 'agents')).filter((n) => n.endsWith('.md'))) {
    const p = path.join(claudeDir, 'agents', f);
    out.agents.push(toAgent(p, home, f.replace(/\.md$/, '')));
  }
  for (const d of safeList(path.join(claudeDir, 'skills'))) {
    const p = path.join(claudeDir, 'skills', d, 'SKILL.md');
    if (fs.existsSync(p)) out.skills.push(toAgent(p, home, d));
  }
  const cmds = (dir: string, prefix: string) => {
    for (const e of safeDirents(dir)) {
      if (e.isDirectory()) cmds(path.join(dir, e.name), `${prefix}${e.name}:`);
      else if (e.name.endsWith('.md')) out.commands.push(toAgent(path.join(dir, e.name), home, prefix + e.name.replace(/\.md$/, '')));
    }
  };
  cmds(path.join(claudeDir, 'commands'), '');
}

function toAgent(file: string, home: string, fallback: string): ScanAgent {
  const fm = frontmatter(file);
  const tools = fm.tools ?? fm['allowed-tools'] ?? '';
  return {
    name: fm.name || fallback,
    description: (fm.description || '').slice(0, 300),
    model: fm.model && fm.model !== 'inherit' ? fm.model : '',
    tools: tools ? tools.split(/[,\s]+/).filter(Boolean) : [],
    path: file,
    home,
  };
}

/** Frontmatter YAML simples (chave: valor numa linha; listas com "- item" viram vírgulas). */
function frontmatter(file: string): Record<string, string> {
  let head: string;
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('utf8').replace(/^﻿/, '');
  } catch {
    return {};
  }
  const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  let last = '';
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) {
      last = kv[1];
      out[last] = kv[2].replace(/^["']|["']$/g, '').trim();
    } else if (last && /^\s+-\s+/.test(line)) out[last] = [out[last], line.replace(/^\s+-\s+/, '').trim()].filter(Boolean).join(', ');
    else if (last && /^\s+\S/.test(line) && out[last] !== undefined) out[last] = `${out[last]} ${line.trim()}`.trim();
  }
  if (/^[>|]-?$/.test(out.description ?? '')) out.description = '';
  return out;
}

function countMarkdown(dir: string): { count: number; entry: string | null } {
  let count = 0;
  let entry: string | null = null;
  let first: string | null = null;
  const walk = (d: string, depth: number) => {
    if (count > 5000) return;
    for (const e of safeDirents(d)) {
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !IGNORED.has(e.name) && depth < 6) walk(path.join(d, e.name), depth + 1);
      } else if (/\.md$/i.test(e.name) && !e.name.startsWith('._')) {
        count++;
        if (depth === 0) {
          first ??= path.join(d, e.name);
          if (!entry && (e.name === 'MEMORY.md' || ENTRY.test(e.name))) entry = path.join(d, e.name);
        }
      }
    }
  };
  walk(dir, 0);
  return { count, entry: entry ?? first };
}

function detectStack(dir: string, names: Set<string>): string[] {
  const s = new Set<string>();
  if (names.has('package.json')) {
    let pkg: any = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      /* inválido */
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const has = (d: string) => d in deps;
    s.add(has('typescript') || names.has('tsconfig.json') ? 'TypeScript' : 'Node.js');
    for (const [dep, label] of [
      ['next', 'Next.js'],
      ['react', 'React'],
      ['vue', 'Vue'],
      ['svelte', 'Svelte'],
      ['@angular/core', 'Angular'],
      ['vite', 'Vite'],
      ['electron', 'Electron'],
      ['express', 'Express'],
      ['fastify', 'Fastify'],
      ['@nestjs/core', 'NestJS'],
      ['prisma', 'Prisma'],
      ['@supabase/supabase-js', 'Supabase'],
      ['tailwindcss', 'Tailwind'],
    ] as const)
      if (has(dep)) s.add(label);
    if (pkg.workspaces) s.add('Monorepo');
  }
  if (names.has('pyproject.toml') || names.has('requirements.txt')) {
    s.add('Python');
    const txt = ['pyproject.toml', 'requirements.txt'].map((f) => safeRead(path.join(dir, f))).join('\n').toLowerCase();
    for (const [dep, label] of [['django', 'Django'], ['fastapi', 'FastAPI'], ['flask', 'Flask']] as const) if (txt.includes(dep)) s.add(label);
  }
  if (names.has('go.mod')) s.add('Go');
  if (names.has('cargo.toml')) s.add('Rust');
  if (names.has('composer.json')) s.add('PHP');
  if (names.has('docker-compose.yml') || names.has('docker-compose.yaml') || names.has('compose.yml') || names.has('dockerfile')) s.add('Docker');
  if (names.has('supabase')) s.add('Supabase');
  if (names.has('vercel.json') || names.has('.vercel')) s.add('Vercel');
  if (names.has('index.html') && !names.has('package.json')) s.add('Site estático');
  return [...s];
}

function readMcp(root: string): string[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
    return Object.keys(j.mcpServers ?? {});
  } catch {
    return [];
  }
}

/** O Claude Code resolve agentes por nome dentro de cada pasta: o mesmo nome conta uma vez. */
function dedupe(items: ScanAgent[]): ScanAgent[] {
  const seen = new Set<string>();
  return items.filter((a) => {
    const k = `${a.home.toLowerCase()}|${a.name.toLowerCase()}`;
    return !seen.has(k) && !!seen.add(k);
  });
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
function safeDirents(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function safeRead(f: string): string {
  try {
    return fs.readFileSync(f, 'utf8').slice(0, 20_000);
  } catch {
    return '';
  }
}
