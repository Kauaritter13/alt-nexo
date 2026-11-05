import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GitStatus } from '@nexo/shared';
import { badRequest } from './repo.js';

export function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    return path.normalize((await git(cwd, ['rev-parse', '--show-toplevel'])).trim());
  } catch {
    return null;
  }
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const empty: GitStatus = { isRepo: false, branch: null, ahead: 0, behind: 0, remote: null, changes: [], log: [], worktrees: [] };
  if (!fs.existsSync(cwd) || !(await repoRoot(cwd))) return empty;
  const st = await git(cwd, ['status', '--porcelain=v1', '--branch']);
  const lines = st.split('\n').filter(Boolean);
  const head = lines[0]?.startsWith('##') ? lines.shift()! : '';
  const m = head.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\])?/);
  let remote: string | null = null;
  try {
    remote = (await git(cwd, ['remote', 'get-url', 'origin'])).trim() || null;
  } catch {
    /* sem remote */
  }
  let log: GitStatus['log'] = [];
  try {
    log = (await git(cwd, ['log', '-n', '20', '--pretty=format:%h\x1f%s\x1f%an\x1f%ar']))
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, subject, author, date] = l.split('\x1f');
        return { hash, subject, author, date };
      });
  } catch {
    /* repositório sem commits */
  }
  const worktrees: GitStatus['worktrees'] = [];
  try {
    let cur: { path: string; branch: string | null } | null = null;
    for (const l of (await git(cwd, ['worktree', 'list', '--porcelain'])).split('\n')) {
      if (l.startsWith('worktree ')) {
        cur = { path: path.normalize(l.slice(9)), branch: null };
        worktrees.push(cur);
      } else if (l.startsWith('branch ') && cur) cur.branch = l.slice(7).replace('refs/heads/', '');
    }
  } catch {
    /* ignore */
  }
  return {
    isRepo: true,
    branch: m?.[1] ?? null,
    ahead: Number(m?.[3] ?? 0),
    behind: Number(m?.[4] ?? 0),
    remote,
    changes: lines.map((l) => ({ code: l.slice(0, 2).trim(), path: l.slice(3) })),
    log,
    worktrees,
  };
}

export async function gitClone(url: string, dest: string) {
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) throw badRequest('URL de repositório inválida');
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw badRequest('O diretório de destino já existe e não está vazio');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await git(path.dirname(dest), ['clone', url, dest], 10 * 60_000);
}

export async function gitInit(cwd: string) {
  fs.mkdirSync(cwd, { recursive: true });
  await git(cwd, ['init']);
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'agente';

/**
 * Cria um git worktree dedicado para um agente (evita que agentes sobrescrevam
 * alterações uns dos outros). Fica ao lado do repositório: <pai>/.nexo-worktrees/<repo>-<agente>.
 */
export async function ensureAgentWorktree(cwd: string, agentName: string, nodeId: string): Promise<string> {
  const root = await repoRoot(cwd);
  if (!root) throw badRequest(`"${cwd}" não é um repositório Git — o isolamento por worktree exige Git.`);
  const short = nodeId.slice(0, 6);
  const name = `${path.basename(root)}-${slug(agentName)}-${short}`;
  const wtPath = path.join(path.dirname(root), '.nexo-worktrees', name);
  if (fs.existsSync(path.join(wtPath, '.git'))) return wtPath;
  const branch = `nexo/${slug(agentName)}-${short}`;
  let hasCommits = true;
  try {
    await git(root, ['rev-parse', 'HEAD']);
  } catch {
    hasCommits = false;
  }
  if (!hasCommits) throw badRequest('O repositório precisa de ao menos um commit para criar worktrees.');
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  let branchExists = true;
  try {
    await git(root, ['rev-parse', '--verify', branch]);
  } catch {
    branchExists = false;
  }
  await git(root, branchExists ? ['worktree', 'add', wtPath, branch] : ['worktree', 'add', '-b', branch, wtPath]);
  // Mantém o subdiretório relativo, se o agente apontava para dentro do repo.
  const rel = path.relative(root, path.resolve(cwd));
  return rel && !rel.startsWith('..') ? path.join(wtPath, rel) : wtPath;
}
