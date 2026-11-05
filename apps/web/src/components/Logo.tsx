/**
 * Marca ALt. (SaaS/brand/): wordmark em paths (não depende de fonte) e o símbolo de três
 * pontos — o ponto é sempre limão. "ALt.nexo" = wordmark da empresa + nome do produto.
 */

/** Símbolo de app (tile com três pontos). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="ALt.nexo">
      <rect x="6" y="6" width="500" height="500" rx="112" fill="#0C0D0B" stroke="#F3EFE0" strokeOpacity="0.08" strokeWidth="4" />
      <circle cx="144" cy="256" r="40" fill="#F3EFE0" />
      <circle cx="256" cy="256" r="40" fill="#F3EFE0" />
      <circle cx="368" cy="256" r="40" fill="#C9F24C" />
    </svg>
  );
}

/** Wordmark "ALt." — tinta segue o tema, ponto final na cor de marca. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 296 144" role="img" aria-label="ALt." className={className}>
      <g fill="none" stroke="var(--foreground)" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 120 L58 22 L96 120" />
        <path d="M34 84 H82" />
        <path d="M136 22 V120 H186" />
        <path d="M218 40 V94 Q218 120 242 120" />
        <path d="M200 64 H238" />
      </g>
      <circle cx="272" cy="109" r="11" style={{ fill: 'var(--claude)' }} />
    </svg>
  );
}

/** Marca completa do produto: "ALt." + "nexo" (mesmo padrão do ALt.chat). */
export function ProductMark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <span className={`inline-flex items-end gap-[3px] leading-none ${className ?? ''}`} style={{ height: size }}>
      <Wordmark className="h-full w-auto" />
      <span className="pb-[2px] font-semibold tracking-tight text-foreground" style={{ fontSize: size * 0.72 }}>
        nexo
      </span>
    </span>
  );
}
