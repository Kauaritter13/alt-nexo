import * as React from 'react';
import type { Folder, Project } from '@nexo/shared';
import { toast } from 'sonner';
import { FolderOpen, GitBranch, Lightbulb, FolderPlus, FolderInput } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useApp } from '@/stores/app';
import { Button, Dialog, DialogContent, Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui';
import { usePicker } from './FolderPicker';
import { ScanStatus, ScanSummary, useFolderScan } from './FolderMap';
import { navigate } from '@/lib/router';

/** Paleta ALt.: limão da marca + tons decorativos + estados. */
export const PROJECT_COLORS = ['#c9f24c', '#6ea8fe', '#b892f2', '#4fd1c5', '#f28fb0', '#e0a83c', '#3fb984', '#8f8c7c'];

type Mode = 'idea' | 'existing' | 'new' | 'clone';

export function folderOptions(folders: Folder[]) {
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parent)) {
      out.push({ id: f.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function NewProjectDialog({ open, onOpenChange, folderId }: { open: boolean; onOpenChange: (v: boolean) => void; folderId: string | null }) {
  const folders = useApp((s) => s.folders);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [folder, setFolder] = React.useState<string | null>(folderId);
  const [color, setColor] = React.useState(PROJECT_COLORS[0]);
  const [mode, setMode] = React.useState<Mode>('existing');
  const [path, setPath] = React.useState('');
  const [baseDir, setBaseDir] = React.useState('');
  const [cloneUrl, setCloneUrl] = React.useState('');
  const [gitInit, setGitInit] = React.useState(true);
  const [seed, setSeed] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const picker = usePicker();
  const folderScan = useFolderScan(open && mode === 'existing' && path.trim() ? path.trim() : null);

  React.useEffect(() => {
    if (!open) return;
    setFolder(folderId);
    setName('');
    setDescription('');
    setPath('');
    setCloneUrl('');
    api.settings().then((s) => setBaseDir(s.defaultProjectsDir));
  }, [open, folderId]);

  const slug = name.trim().replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '-');
  const sep = baseDir.includes('/') && !baseDir.includes('\\') ? '/' : '\\';
  const target = mode === 'existing' ? path : mode === 'new' || mode === 'clone' ? (baseDir && slug ? `${baseDir.replace(/[\\/]+$/, '')}${sep}${slug}` : '') : '';

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api.createProject({
        name: name.trim(),
        description,
        folderId: folder,
        color,
        rootPath: target || null,
        createDir: mode === 'new',
        gitInit: mode === 'new' && gitInit,
        cloneUrl: mode === 'clone' ? cloneUrl.trim() : undefined,
        seed: (mode === 'existing' || mode === 'clone') && seed,
      });
      await useApp.getState().refreshProjects();
      onOpenChange(false);
      navigate.project(p.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const modes: { id: Mode; icon: React.ComponentType<{ className?: string }>; title: string; desc: string }[] = [
    { id: 'idea', icon: Lightbulb, title: 'Só ideias', desc: 'Canvas para organizar, sem diretório' },
    { id: 'existing', icon: FolderInput, title: 'Pasta existente', desc: 'Importar um projeto do disco' },
    { id: 'new', icon: FolderPlus, title: 'Nova pasta', desc: 'Criar diretório (e git init)' },
    { id: 'clone', icon: GitBranch, title: 'Clonar Git', desc: 'Clonar um repositório remoto' },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Novo projeto" description="Os metadados do canvas ficam no banco do ALt.nexo — nada é escrito na pasta do seu código.">
        <Field label="Nome">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: ALT.chat" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn('flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors', mode === m.id ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-accent/50')}
            >
              <m.icon className={cn('mt-0.5 size-4', mode === m.id ? 'text-primary' : 'text-muted-foreground')} />
              <div>
                <div className="text-[12.5px] font-medium">{m.title}</div>
                <div className="text-[11px] text-muted-foreground">{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
        {mode === 'existing' && (
          <Field label="Diretório">
            <div className="flex gap-1.5">
              <Input value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-[12px]" placeholder="C:\Users\…\meu-projeto" />
              <Button
                size="icon"
                variant="secondary"
                onClick={async () => {
                  const p = await picker.pick('folder');
                  if (p) {
                    setPath(p);
                    if (!name) setName(p.split(/[\\/]/).filter(Boolean).pop() ?? '');
                  }
                }}
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
        )}
        {mode === 'existing' && path.trim() && (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-muted/40 p-3">
            <ScanStatus {...folderScan} />
            {folderScan.scan && !folderScan.loading && <ScanSummary scan={folderScan.scan} compact />}
          </div>
        )}
        {(mode === 'existing' || mode === 'clone') && (
          <label className="flex items-center gap-2 text-[12.5px]">
            <Switch checked={seed} onCheckedChange={setSeed} /> Montar o canvas com agentes, cérebro e arquivos encontrados
          </label>
        )}
        {mode === 'clone' && (
          <Field label="URL do repositório">
            <Input value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} className="font-mono text-[12px]" placeholder="https://github.com/usuario/repo.git" />
          </Field>
        )}
        {(mode === 'new' || mode === 'clone') && (
          <Field label="Local" hint={target ? `Será criado em ${target}` : 'Informe o nome do projeto'}>
            <div className="flex gap-1.5">
              <Input value={baseDir} onChange={(e) => setBaseDir(e.target.value)} className="font-mono text-[12px]" />
              <Button
                size="icon"
                variant="secondary"
                onClick={async () => {
                  const p = await picker.pick('folder', baseDir);
                  if (p) setBaseDir(p);
                }}
              >
                <FolderOpen />
              </Button>
            </div>
          </Field>
        )}
        {mode === 'new' && (
          <label className="flex items-center gap-2 text-[12.5px]">
            <Switch checked={gitInit} onCheckedChange={setGitInit} /> Inicializar repositório Git
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pasta">
            <NativeSelect value={folder ?? ''} onChange={(e) => setFolder(e.target.value || null)}>
              <option value="">Sem pasta</option>
              {folderOptions(folders).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Cor">
            <div className="flex h-8 items-center gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button key={c} className={cn('size-5 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-popover', color === c && 'ring-foreground/70')} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </Field>
        </div>
        <Field label="Descrição">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || (mode === 'existing' && !path) || (mode === 'clone' && !cloneUrl)}>
            {busy ? 'Criando…' : 'Criar projeto'}
          </Button>
        </div>
        {picker.element}
      </DialogContent>
    </Dialog>
  );
}

export function EditProjectDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const folders = useApp((s) => s.folders);
  const [p, setP] = React.useState<Project | null>(project);
  const picker = usePicker();
  React.useEffect(() => setP(project), [project]);
  if (!p) return null;
  const save = async () => {
    try {
      await api.updateProject(p.id, { name: p.name, description: p.description, color: p.color, folderId: p.folderId, rootPath: p.rootPath || null });
      await useApp.getState().refreshProjects();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Configurações do projeto">
        <Field label="Nome">
          <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <Field label="Descrição">
          <Textarea rows={2} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
        </Field>
        <Field label="Diretório vinculado" hint="Usado como diretório padrão dos novos agentes e terminais, e pelo painel de arquivos/Git.">
          <div className="flex gap-1.5">
            <Input value={p.rootPath ?? ''} onChange={(e) => setP({ ...p, rootPath: e.target.value })} className="font-mono text-[12px]" placeholder="nenhum" />
            <Button
              size="icon"
              variant="secondary"
              onClick={async () => {
                const r = await picker.pick('folder', p.rootPath ?? undefined);
                if (r) setP({ ...p, rootPath: r });
              }}
            >
              <FolderOpen />
            </Button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pasta">
            <NativeSelect value={p.folderId ?? ''} onChange={(e) => setP({ ...p, folderId: e.target.value || null })}>
              <option value="">Sem pasta</option>
              {folderOptions(folders).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Cor">
            <div className="flex h-8 items-center gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button key={c} className={cn('size-5 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-popover', p.color === c && 'ring-foreground/70')} style={{ background: c }} onClick={() => setP({ ...p, color: c })} />
              ))}
            </div>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save}>Salvar</Button>
        </div>
        {picker.element}
      </DialogContent>
    </Dialog>
  );
}

/** Diálogo simples de texto (renomear/criar pasta), substitui window.prompt. */
export function PromptDialog({ title, initial = '', label, onSubmit, onClose }: { title: string; initial?: string; label: string; onSubmit: (v: string) => void | Promise<void>; onClose: () => void }) {
  const [v, setV] = React.useState(initial);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} className="w-[min(420px,calc(100vw-32px))]">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!v.trim()) return;
            await onSubmit(v.trim());
            onClose();
          }}
        >
          <Field label={label}>
            <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!v.trim()}>
              OK
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({ title, description, confirm = 'Confirmar', danger, onConfirm, onClose }: { title: string; description: string; confirm?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={description} className="w-[min(440px,calc(100vw-32px))]">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            onClick={async () => {
              await onConfirm();
              onClose();
            }}
          >
            {confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
