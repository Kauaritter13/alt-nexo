import * as React from 'react';
import { Loader2, PlugZap, Terminal } from 'lucide-react';
import { useApp } from '@/stores/app';
import { Button, Input } from '@/components/ui';
import { Logo, ProductMark } from '@/components/Logo';

/** Tela exibida quando o runtime local não está acessível ou este navegador ainda não foi pareado. */
export function Connect() {
  const auth = useApp((s) => s.auth);
  const authError = useApp((s) => s.authError);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      await useApp.getState().pair(code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--primary)_7%,transparent),transparent)]">
      <div className="w-[min(460px,calc(100vw-32px))] rounded-2xl border border-border bg-card p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="size-10" />
          <div>
            <ProductMark size={24} />
            <div className="mt-1.5 text-[12px] text-muted-foreground">IDE visual orientada a agentes</div>
          </div>
        </div>
        {auth === 'checking' && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Conectando ao runtime local…
          </div>
        )}
        {auth === 'offline' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <PlugZap className="size-4 text-warning" /> Runtime local não encontrado
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              A interface web não executa comandos pelo navegador. Ela se conecta ao serviço local do ALt.nexo, que gerencia terminais e o Claude Code com
              autenticação. Abra o app desktop ou inicie o runtime:
            </p>
            <pre className="rounded-lg border border-border bg-background/80 p-3 font-mono text-[12px]">
              <Terminal className="mr-2 inline size-3.5 text-muted-foreground" />
              npm start
            </pre>
            <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Tentando novamente…
            </div>
          </div>
        )}
        {auth === 'unpaired' && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void pair();
            }}
          >
            <div className="text-[14px] font-medium">Parear este navegador</div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Por segurança, o runtime só aceita navegadores pareados. Abra o link exibido no terminal onde o runtime foi iniciado, ou cole-o abaixo.
            </p>
            <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="http://127.0.0.1:7420/?pair=…" className="font-mono text-[12px]" />
            {(error || authError) && <div className="text-[12px] text-destructive">{error || authError}</div>}
            <Button type="submit" disabled={!code.trim() || busy}>
              {busy ? <Loader2 className="animate-spin" /> : null} Parear
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
