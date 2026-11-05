import * as React from 'react';
import { cn } from '@/lib/utils';
import { fitTerminal, mountTerminal } from './registry';

/** Container onde a instância xterm do nó é montada. Reajusta colunas/linhas ao redimensionar. */
export function TerminalView({ nodeId, className, active = true }: { nodeId: string; className?: string; active?: boolean }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    mountTerminal(nodeId, el);
    const ro = new ResizeObserver(() => fitTerminal(nodeId));
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodeId, active]);

  return (
    <div
      ref={ref}
      className={cn('nodrag nowheel nopan h-full w-full min-h-0 cursor-text bg-term', className)}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}
