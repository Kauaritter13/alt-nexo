import * as React from 'react';
import { toast } from 'sonner';
import { CheckCircle2, FolderOpen, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { isDesktop } from '@/lib/desktop';
import { useApp } from '@/stores/app';
import { useUI } from '@/stores/ui';
import { Badge, Button, Dialog, DialogContent, Field, Input } from '@/components/ui';
import { usePicker } from './FolderPicker';

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  const system = useApp((s) => s.system);
  const [roots, setRoots] = React.useState<string[]>([]);
  const [projectsDir, setProjectsDir] = React.useState('');
  const [backups, setBackups] = React.useState<{ name: string; size: number }[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const picker = usePicker();

  React.useEffect(() => {
    if (!open) return;
    api.settings().then((s) => {
      setRoots(s.allowedRoots);
      setProjectsDir(s.defaultProjectsDir);
    });
    api.backups().then(setBackups);
  }, [open]);

  const saveRoots = async (r: string[]) => {
    setRoots(r);
    await api.saveSettings({ allowedRoots: r });
  };
  const c = system?.claude;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent title="Configurações" className="w-[min(640px,calc(100vw-32px))]">
        <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">Claude Code</span>
            {c?.loggedIn ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3" /> autenticado {c.authMethod && `· ${c.authMethod}`}
              </Badge>
            ) : c?.path ? (
              <Badge tone="warning">não autenticado</Badge>
            ) : (
              <Badge tone="danger">
                <XCircle className="size-3" /> não encontrado
              </Badge>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              className="ml-auto"
              onClick={async () => {
                setRefreshing(true);
                await useApp.getState().refreshSystem(true);
                setRefreshing(false);
              }}
            >
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            </Button>
          </div>
          <div className="grid grid-cols-[90px_1fr] gap-y-1 text-[12px]">
            <span className="text-muted-foreground">Versão</span>
            <span className="font-mono">{c?.version ?? '—'}</span>
            <span className="text-muted-foreground">Executável</span>
            <span className="truncate font-mono text-[11px]">{c?.path ?? '—'}</span>
          </div>
          {c?.error && <p className="text-[12px] text-destructive">{c.error}</p>}
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            O ALt.nexo usa a autenticação oficial do Claude Code instalado nesta máquina e nunca lê ou armazena suas credenciais. Para entrar, adicione um nó Claude
            Code e use <code className="font-mono">/login</code> dentro dele, ou rode <code className="font-mono">claude auth login</code> num nó de terminal.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <Field label="Pastas autorizadas extras" hint="Além dos diretórios de projetos e agentes, o runtime só lê/escreve arquivos dentro destas pastas.">
            <div className="flex flex-col gap-1.5">
              {roots.map((r) => (
                <div key={r} className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1">
                  <span className="flex-1 truncate font-mono text-[11.5px]">{r}</span>
                  <Button size="icon-xs" variant="ghost" onClick={() => saveRoots(roots.filter((x) => x !== r))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                onClick={async () => {
                  const p = await picker.pick('folder');
                  if (p && !roots.includes(p)) await saveRoots([...roots, p]);
                }}
              >
                <FolderOpen /> Adicionar pasta
              </Button>
            </div>
          </Field>
          <Field label="Pasta padrão para novos projetos">
            <Input value={projectsDir} onChange={(e) => setProjectsDir(e.target.value)} onBlur={() => api.saveSettings({ defaultProjectsDir: projectsDir })} className="font-mono text-[12px]" />
          </Field>
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-border p-4">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">Dados e backup</span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={async () => {
                const r = await api.backup();
                toast.success(`Backup criado: ${r.file}`);
                setBackups(await api.backups());
              }}
            >
              Fazer backup agora
            </Button>
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{system?.dataDir}</div>
          <p className="text-[11px] text-muted-foreground">Backups automáticos diários (14 últimos). Para restaurar, feche o ALt.nexo e substitua nexo.db por um arquivo da pasta backups.</p>
          <div className="max-h-28 overflow-auto text-[11px]">
            {backups.slice(0, 12).map((b) => (
              <div key={b.name} className="flex justify-between py-0.5 font-mono text-muted-foreground">
                <span className="truncate">{b.name}</span>
                <span>{(b.size / 1024).toFixed(0)} KB</span>
              </div>
            ))}
          </div>
        </section>

        {!isDesktop && (
          <section className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <ShieldAlert className="size-5 text-destructive" />
            <div className="flex-1 text-[12px]">
              <div className="font-medium">Acesso deste navegador</div>
              <div className="text-muted-foreground">Revogar todos os navegadores pareados (será preciso parear de novo).</div>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                await api.revokeAll();
                useApp.getState().logout();
              }}
            >
              Revogar
            </Button>
          </section>
        )}
        <div className="text-center text-[11px] text-muted-foreground">
          ALt.nexo {system?.version} · {system?.desktop ? 'Desktop' : 'Web'} · {system?.platform}
        </div>
        {picker.element}
      </DialogContent>
    </Dialog>
  );
}
