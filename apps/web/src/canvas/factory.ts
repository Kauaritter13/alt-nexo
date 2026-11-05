import type { NodeKind, NodeDataMap } from '@nexo/shared';
import { Bot, FileText, Globe, Group, ListTodo, SquareTerminal, StickyNote, type LucideIcon } from 'lucide-react';

export const PALETTE: { kind: NodeKind; label: string; description: string; icon: LucideIcon; color: string; key?: string }[] = [
  { kind: 'claude', label: 'Claude Code', description: 'Instância real do Claude Code com sessão própria', icon: Bot, color: 'text-claude', key: 'C' },
  { kind: 'terminal', label: 'Terminal', description: 'Shell interativo (PowerShell, cmd, bash…)', icon: SquareTerminal, color: 'text-tone-1', key: 'T' },
  { kind: 'task', label: 'Tarefa', description: 'Atividade que pode ser atribuída a agentes', icon: ListTodo, color: 'text-tone-2', key: 'K' },
  { kind: 'note', label: 'Anotação', description: 'Ideias e documentação em Markdown', icon: StickyNote, color: 'text-warning', key: 'N' },
  { kind: 'site', label: 'Site', description: 'Página web dentro do canvas', icon: Globe, color: 'text-tone-3', key: 'W' },
  { kind: 'file', label: 'Arquivo', description: 'Arquivo local com visualização e edição', icon: FileText, color: 'text-tone-4', key: 'F' },
  { kind: 'group', label: 'Grupo', description: 'Moldura para organizar elementos', icon: Group, color: 'text-muted-foreground', key: 'G' },
];

export function defaultData<K extends NodeKind>(kind: K, ctx: { cwd: string; agentCount: number; shell: string }): NodeDataMap[K] {
  const map: { [P in NodeKind]: NodeDataMap[P] } = {
    claude: { name: `Claude ${ctx.agentCount + 1}`, cwd: ctx.cwd, role: '', permissionMode: 'default', model: '', isolate: false },
    terminal: { name: 'Terminal', cwd: ctx.cwd, shell: ctx.shell },
    note: { text: '', color: 'lime' },
    task: { title: '', description: '', status: 'todo' },
    site: { url: '' },
    file: { path: '' },
    group: { label: 'Grupo', color: 'var(--tone-2)' },
  };
  return map[kind] as NodeDataMap[K];
}

export const ROLE_PRESETS: { name: string; role: string }[] = [
  { name: 'Backend', role: 'Você é o agente de Backend. Responsável pela API, regras de negócio e banco de dados. Não altere arquivos de frontend.' },
  { name: 'Frontend', role: 'Você é o agente de Frontend. Responsável pela interface, componentes e experiência do usuário. Não altere a API.' },
  { name: 'Testes', role: 'Você é o agente de Testes. Escreva e execute testes automatizados, reporte falhas com evidências. Não implemente features.' },
  { name: 'Revisão', role: 'Você é o agente de Revisão. Analise as alterações (git diff), aponte bugs, riscos e melhorias. Não edite código.' },
];
