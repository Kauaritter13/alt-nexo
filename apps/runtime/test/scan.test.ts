import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScanGraph } from '@nexo/shared';
import { scanFolder } from '../src/scan.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-scan-'));
  const w = (rel: string, content = '') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  w('CLAUDE.md', '# regras');
  w('package.json', JSON.stringify({ dependencies: { react: '1', next: '1' }, devDependencies: { typescript: '5' } }));
  w('.claude/agents/backend.md', '---\nname: backend\ndescription: Cuida da API\nmodel: sonnet\ntools: Read, Edit\n---\nVocê é o backend.');
  w('.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Publica\n---\n');
  w('.claude/commands/git/ship.md', 'faz o ship');
  w('.mcp.json', JSON.stringify({ mcpServers: { supabase: {} } }));
  w('api/package.json', '{}');
  w('api/.claude/agents/db.md', '---\ndescription: Banco\n---\n');
  w('Meu-Vault/.obsidian/app.json', '{}');
  w('Meu-Vault/Home.md', '# home');
  w('Meu-Vault/ideias/a.md', 'a');
  w('docs/um.md', '1');
  w('docs/dois.md', '2');
  w('src/index.ts', 'export {}');
  w('node_modules/x/index.js', '');
  return root;
}

test('leitura de pasta: agentes, cérebro e arquivos', () => {
  const root = fixture();
  const s = scanFolder(root);
  assert.deepEqual(s.agents.map((a) => a.name).sort(), ['backend', 'db']);
  const backend = s.agents.find((a) => a.name === 'backend')!;
  assert.equal(backend.model, 'sonnet');
  assert.deepEqual(backend.tools, ['Read', 'Edit']);
  assert.equal(s.agents.find((a) => a.name === 'db')!.home, path.join(root, 'api'));
  assert.deepEqual(s.skills.map((x) => x.name), ['deploy']);
  assert.deepEqual(s.commands.map((x) => x.name), ['git:ship']);
  assert.deepEqual(s.mcp, ['supabase']);

  const kinds = s.brain.map((b) => `${b.kind}:${path.basename(b.path)}`);
  assert.equal(kinds[0], 'instructions:CLAUDE.md');
  assert.ok(kinds.includes('vault:Meu-Vault'));
  assert.ok(kinds.includes('docs:docs'));
  const vault = s.brain.find((b) => b.kind === 'vault')!;
  assert.equal(vault.notes, 2);
  assert.equal(path.basename(vault.entry!), 'Home.md');

  assert.ok(s.files.stack.includes('Next.js') && s.files.stack.includes('TypeScript'));
  assert.deepEqual(s.files.subprojects.map((p) => p.name), ['api']);
  assert.ok(!fs.readdirSync(root).includes('.nexo'), 'nada é escrito na pasta');

  const g = buildScanGraph(s, { origin: { x: 0, y: 0 }, shell: 'pwsh', newId: () => Math.random().toString(36).slice(2) });
  const groups = g.nodes.filter((n) => n.type === 'group').map((n) => (n.data as any).label);
  assert.deepEqual(groups, ['Agentes (2)', 'Cérebro (3)', 'Arquivos']);
  const claude = g.nodes.filter((n) => n.type === 'claude').map((n) => n.data as any);
  assert.equal(claude.find((d) => d.agent === 'db').cwd, path.join(root, 'api'));
  assert.equal(g.edges.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});
