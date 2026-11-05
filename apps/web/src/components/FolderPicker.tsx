import * as React from 'react';
import type { FsEntry } from '@nexo/shared';
import { ArrowUp, File, Folder, FolderOpen, HardDrive, Home } from 'lucide-react';
import { api } from '@/lib/api';
import { desktop } from '@/lib/desktop';
import { cn } from '@/lib/utils';
import { Button, Dialog, DialogContent, Input } from '@/components/ui';

/**
 * Seleção de pasta/arquivo: diálogo nativo no desktop; no navegador, navegação pelo runtime local
 * (apenas nomes são listados — conteúdo só é lido em pastas autorizadas).
 */
export function usePicker() {
  const [state, setState] = React.useState<{ mode: 'folder' | 'file'; start?: string; resolve: (p: string | null) => void } | null>(null);
  const pick = React.useCallback(async (mode: 'folder' | 'file', start?: string): Promise<string | null> => {
    if (desktop) return mode === 'folder' ? desktop.pickFolder(start) : desktop.pickFile(start);
    return new Promise((resolve) => setState({ mode, start, resolve }));
  }, []);
  const element = state ? (
    <PickerDialog
      mode={state.mode}
      start={state.start}
      onClose={(p) => {
        state.resolve(p);
        setState(null);
      }}
    />
  ) : null;
  return { pick, element };
}

function parent(p: string) {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  if (parts.length <= 1) return null;
  parts.pop();
  const r = parts.join('\\');
  return /^[A-Za-z]:$/.test(r) ? r + '\\' : r || '/';
}

function PickerDialog({ mode, start, onClose }: { mode: 'folder' | 'file'; start?: string; onClose: (p: string | null) => void }) {
  const [cwd, setCwd] = React.useState(start ?? '');
  const [entries, setEntries] = React.useState<FsEntry[]>([]);
  const [home, setHome] = React.useState<{ home: string; drives: string[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [path, setPath] = React.useState(start ?? '');

  React.useEffect(() => {
    api.fsHome().then((h) => {
      setHome(h);
      if (!start) setCwd(h.home);
    });
  }, [start]);

  React.useEffect(() => {
    if (!cwd) return;
    setPath(cwd);
    setError(null);
    api
      .fsList(cwd)
      .then((e) => setEntries(mode === 'folder' ? e.filter((x) => x.dir) : e))
      .catch((e) => setError(e.message));
  }, [cwd, mode]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose(null)}>
      <DialogContent title={mode === 'folder' ? 'Selecionar pasta' : 'Selecionar arquivo'} className="w-[min(640px,calc(100vw-32px))]">
        <div className="flex gap-1.5">
          <Button size="icon" variant="secondary" onClick={() => home && setCwd(home.home)} title="Pasta do usuário">
            <Home />
          </Button>
          <Button size="icon" variant="secondary" onClick={() => parent(cwd) && setCwd(parent(cwd)!)} title="Subir">
            <ArrowUp />
          </Button>
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setCwd(path);
            }}
          >
            <Input value={path} onChange={(e) => setPath(e.target.value)} className="h-8 font-mono text-[12px]" />
          </form>
        </div>
        {home && home.drives.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {home.drives.map((d) => (
              <Button key={d} size="sm" variant="ghost" onClick={() => setCwd(d)}>
                <HardDrive /> {d}
              </Button>
            ))}
          </div>
        )}
        <div className="h-[340px] overflow-auto rounded-lg border border-border bg-background/60 p-1">
          {error && <div className="p-3 text-[12px] text-destructive">{error}</div>}
          {entries.map((e) => (
            <button
              key={e.path}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-accent', selected === e.path && 'bg-primary/15 text-primary')}
              onClick={() => setSelected(e.path)}
              onDoubleClick={() => (e.dir ? setCwd(e.path) : onClose(e.path))}
            >
              {e.dir ? <Folder className="size-4 text-warning/80" /> : <File className="size-4 text-muted-foreground" />}
              <span className="truncate">{e.name}</span>
            </button>
          ))}
          {!error && !entries.length && <div className="p-3 text-[12px] text-muted-foreground">Vazio</div>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] text-muted-foreground">{selected ?? cwd}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onClose(null)}>
              Cancelar
            </Button>
            {mode === 'folder' ? (
              <Button onClick={() => onClose(selected && entries.find((e) => e.path === selected)?.dir ? selected : cwd)}>
                <FolderOpen /> Selecionar
              </Button>
            ) : (
              <Button disabled={!selected || entries.find((e) => e.path === selected)?.dir} onClick={() => onClose(selected)}>
                Abrir
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
