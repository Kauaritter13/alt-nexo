import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { EdgeKind } from '@nexo/shared';
import { useApp } from '@/stores/app';
import type { FlowEdge as FlowEdgeType } from '@/stores/canvas';
import { cn } from '@/lib/utils';

export const EDGE_COLORS: Record<EdgeKind, string> = {
  reference: 'var(--edge-reference)',
  context: 'var(--edge-context)',
  dependency: 'var(--edge-dependency)',
  sequential: 'var(--edge-sequential)',
  parallel: 'var(--edge-parallel)',
};

export const EDGE_LABELS: Record<EdgeKind, string> = {
  reference: 'ref',
  context: 'contexto',
  dependency: 'depende',
  sequential: 'sequência',
  parallel: 'paralelo',
};

/** Conexão pontilhada; anima quando há fluxo ativo passando por ela. */
export function FlowEdge({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdgeType>) {
  const kind = data?.kind ?? 'reference';
  const color = EDGE_COLORS[kind];
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });

  const active = useApp((s) =>
    s.runs.some((r) => {
      if (r.status !== 'running' || kind === 'reference') return false;
      const src = r.steps.find((x) => x.nodeId === source);
      const dst = r.steps.find((x) => x.nodeId === target);
      return src?.status === 'running' || (src?.status === 'done' && (dst?.status === 'running' || dst?.status === 'pending'));
    }),
  );

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={cn('nexo-edge-path', active && 'nexo-edge-active')}
        style={{ stroke: color, strokeWidth: selected ? 2.2 : 1.6, strokeDasharray: kind === 'reference' ? '2 6' : '6 5', strokeLinecap: 'round', opacity: selected || active ? 1 : 0.75, color }}
        interactionWidth={18}
      />
      {kind !== 'reference' || data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-full border px-2 py-[1px] text-[10px] font-medium backdrop-blur"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color,
              borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
              background: 'color-mix(in oklab, var(--popover) 90%, transparent)',
            }}
          >
            {data?.label || EDGE_LABELS[kind]}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
