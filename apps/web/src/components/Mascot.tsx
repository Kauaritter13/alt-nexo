/**
 * Nexinho — o mascote do ALt.nexo. Pixel art em SVG (cada letra do mapa é um pixel);
 * a antena carrega o ponto limão da marca. O humor acompanha os agentes:
 *  - sleep:   nenhum agente rodando (olhos fechados, "z")
 *  - idle:    agentes abertos, parados (pisca e respira)
 *  - working: algum agente trabalhando (olha em volta, anda no lugar)
 *  - waiting: algum agente aguardando você ("!" e pulinhos)
 *  - happy:   algo deu certo (pulo)
 */
import { cn } from '@/lib/utils';

export type Mood = 'sleep' | 'idle' | 'working' | 'waiting' | 'happy';

const MAP = [
  '......AA......',
  '......AA......',
  '......SS......',
  '...BBBBBBBB...',
  '..BBBBBBBBBB..',
  '.BBBBBBBBBBBB.',
  '.BBBEEBBEEBBB.',
  '.BBBEEBBEEBBB.',
  '.BBBBBBBBBBBB.',
  '..BBBBBBBBBB..',
  '...LL....RR...',
];

const px = (ch: string) => {
  const out: { x: number; y: number }[] = [];
  MAP.forEach((row, y) => [...row].forEach((c, x) => c === ch && out.push({ x, y })));
  return out;
};
const BODY = [...px('B'), ...px('S')];
const EYES = px('E');
const ANTENNA = px('A');
const LEG_L = px('L');
const LEG_R = px('R');

const rects = (cells: { x: number; y: number }[]) => cells.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1.02} height={1.02} />);

export function Mascot({ mood = 'idle', size = 40, className, title }: { mood?: Mood; size?: number; className?: string; title?: string }) {
  // Dormindo: olhos viram uma linha (só a fileira de baixo).
  const eyes = mood === 'sleep' ? EYES.filter((e) => e.y === 7) : EYES;
  return (
    <span className={cn('nexinho relative inline-block shrink-0', `nexinho-${mood}`, className)} style={{ width: size, height: size * (13 / 14) }} title={title ?? 'Nexinho'}>
      <svg viewBox="0 -2 14 13" width="100%" height="100%" shapeRendering="crispEdges" aria-hidden>
        <g className="nexinho-body">
          <g fill="var(--claude)">{rects(BODY)}</g>
          <g className="nexinho-antenna" fill="#F3EFE0">
            {rects(ANTENNA)}
          </g>
          <g className="nexinho-eyes" fill="#0C0D0B">
            {rects(eyes)}
          </g>
        </g>
        <g className="nexinho-leg-l" fill="var(--claude)">
          {rects(LEG_L)}
        </g>
        <g className="nexinho-leg-r" fill="var(--claude)">
          {rects(LEG_R)}
        </g>
        {mood === 'waiting' && (
          <g fill="var(--warning)" className="nexinho-alert">
            <rect x={11} y={-2} width={1} height={2.2} />
            <rect x={11} y={0.8} width={1} height={0.9} />
          </g>
        )}
      </svg>
      {mood === 'sleep' && <span className="nexinho-z pointer-events-none absolute -right-1 -top-1 font-mono text-[9px] font-bold text-muted-foreground">z</span>}
    </span>
  );
}
