import { cn } from 'cn';
import { type ComponentType, type SVGProps, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';

export interface RoutingSource {
  id: string;
  name: string;
  tag?: string;
  target?: string;
  broken?: boolean;
}

export interface RoutingSourceGroup {
  label: string;
  nodes: RoutingSource[];
}

export interface RoutingTarget {
  id: string;
  name: string;
  runtime: string;
  Mark?: ComponentType<SVGProps<SVGSVGElement>>;
  unavailable?: boolean;
}

interface Wire {
  from: string;
  to: string;
  d: string;
  broken: boolean;
}

const sourceKey = (group: string, id: string) => `${group}/${id}`;

export function RoutingGraph({
  groups,
  targets,
}: {
  groups: RoutingSourceGroup[];
  targets: RoutingTarget[];
}) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<Wire[]>([]);
  const [hot, setHot] = useState<string | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box == null) return;
    const draw = () => {
      const origin = box.getBoundingClientRect();
      const next: Wire[] = [];
      for (const group of groups) {
        for (const node of group.nodes) {
          if (node.target == null) continue;
          const key = sourceKey(group.label, node.id);
          const from = box.querySelector(`[data-wire-out="${CSS.escape(key)}"]`);
          const to = box.querySelector(`[data-wire-in="${CSS.escape(node.target)}"]`);
          if (from == null || to == null) continue;
          const a = from.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          const x1 = a.right - origin.left;
          const y1 = a.top + a.height / 2 - origin.top;
          const x2 = b.left - origin.left;
          const y2 = b.top + b.height / 2 - origin.top;
          const mid = (x1 + x2) / 2;
          next.push({
            from: key,
            to: node.target,
            d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
            broken: node.broken === true,
          });
        }
      }
      setWires(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [groups, targets]);

  const lit = (wire: Wire) => hot !== null && (wire.from === hot || wire.to === hot);
  const hotNodes = new Set(
    hot === null ? [] : wires.filter(lit).flatMap((wire) => [wire.from, wire.to]),
  );

  return (
    <div
      ref={boxRef}
      data-slot="routing-graph"
      onPointerLeave={() => setHot(null)}
      className="relative grid grid-cols-[minmax(0,15rem)_minmax(1.5rem,1fr)_minmax(0,17rem)] py-1"
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {wires.map((wire) => (
          <path
            key={`${wire.from}>${wire.to}`}
            data-wire={wire.from}
            data-broken={wire.broken ? '' : undefined}
            d={wire.d}
            fill="none"
            strokeWidth={1.75}
            strokeDasharray={wire.broken ? '4 4' : undefined}
            className="transition-opacity duration-(--dur-fast)"
            style={{
              stroke: wire.broken
                ? 'var(--destructive)'
                : lit(wire)
                  ? 'var(--foreground)'
                  : 'var(--text-dim)',
              opacity: hot === null || lit(wire) ? 1 : 0.2,
            }}
          />
        ))}
      </svg>
      <div className="col-start-1 flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1.5">
            <div className="px-0.5 text-caption font-medium text-content-tertiary">
              {group.label}
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              {group.nodes.map((node) => {
                const key = sourceKey(group.label, node.id);
                return (
                  <div
                    key={node.id}
                    data-slot="routing-node"
                    data-routing-source={node.id}
                    data-broken={node.broken === true ? '' : undefined}
                    data-wire-out={key}
                    onPointerEnter={() => setHot(key)}
                    className={cn(
                      'flex h-8 items-center gap-2 border-t border-border px-2.5 text-meta first:border-t-0',
                      hotNodes.has(key) && 'bg-sidebar-hover',
                      node.broken === true ? 'text-destructive' : 'text-foreground',
                    )}
                  >
                    <span className="min-w-0 truncate">{node.name}</span>
                    {node.tag != null && (
                      <span className="ml-auto flex-none truncate text-caption text-content-tertiary max-sm:hidden">
                        {node.tag}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="col-start-3 flex flex-col justify-center gap-2">
        <div className="px-0.5 text-caption font-medium text-content-tertiary">{t('服务商')}</div>
        {targets.map((target) => (
          <div
            key={target.id}
            data-slot="routing-node"
            data-routing-target={target.id}
            data-unavailable={target.unavailable === true ? '' : undefined}
            data-wire-in={target.id}
            onPointerEnter={() => setHot(target.id)}
            className={cn(
              'flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-meta whitespace-nowrap',
              target.unavailable === true && 'border-dashed text-content-tertiary',
              hotNodes.has(target.id) && 'bg-sidebar-hover',
            )}
          >
            {target.Mark != null && <target.Mark aria-hidden className="size-4 flex-none" />}
            <span className="min-w-0 truncate">{target.name}</span>
            <span className="ml-auto flex-none text-caption text-content-tertiary max-sm:hidden">
              {target.unavailable === true
                ? t('{runtime} · 不可用', { runtime: target.runtime })
                : target.runtime}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
