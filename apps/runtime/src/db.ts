import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Migrações versionadas via PRAGMA user_version.
 * Nunca edite uma migração já publicada — adicione uma nova ao final.
 */
const MIGRATIONS: string[] = [
  // 1 — esquema inicial
  `
  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    description TEXT NOT NULL DEFAULT '',
    root_path TEXT,
    color TEXT NOT NULL DEFAULT '#8b5cf6',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_opened_at INTEGER
  );
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    viewport TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
    settings TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_ws_project ON workspaces(project_id);
  CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    x REAL NOT NULL, y REAL NOT NULL,
    width REAL NOT NULL, height REAL NOT NULL,
    parent_id TEXT,
    z INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_nodes_ws ON nodes(workspace_id);
  CREATE TABLE edges (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    source_handle TEXT,
    target_handle TEXT,
    kind TEXT NOT NULL DEFAULT 'reference',
    label TEXT
  );
  CREATE INDEX idx_edges_ws ON edges(workspace_id);
  CREATE TABLE sessions (
    node_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    claude_session_id TEXT,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL,
    agent_state TEXT NOT NULL DEFAULT 'unknown',
    started_at INTEGER,
    ended_at INTEGER,
    exit_code INTEGER,
    last_message TEXT,
    last_activity_at INTEGER,
    has_conversation INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    origin_node_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE TABLE run_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT,
    started_at INTEGER,
    finished_at INTEGER,
    seq INTEGER NOT NULL
  );
  CREATE INDEX idx_steps_run ON run_steps(run_id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export type DB = DatabaseSync;

export function openDatabase(dataDir: string): DB {
  const file = path.join(dataDir, 'nexo.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, dataDir);
  return db;
}

function migrate(db: DB, dataDir: string) {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current >= MIGRATIONS.length) return;
  // Backup antes de migrar um banco existente.
  if (current > 0) {
    const bak = path.join(dataDir, 'backups', `pre-migration-v${current}-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${bak.replace(/'/g, "''")}'`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${v + 1}: ${(err as Error).message}`);
    }
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Backup consistente do banco (funciona com WAL ativo). Mantém os N mais recentes. */
export function backupDatabase(db: DB, dataDir: string, reason = 'manual', keep = 20): string {
  const dir = path.join(dataDir, 'backups');
  const file = path.join(dir, `nexo-${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const olds = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`nexo-${reason}-`))
    .sort()
    .reverse();
  for (const f of olds.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}
