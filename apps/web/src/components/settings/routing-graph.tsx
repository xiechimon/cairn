import { cn } from 'cn';
import { type ComponentProps, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { QuotaRow } from './quota-row.js';

export interface RoutingJob {
  id: string;
  name: string;
  model: string;
  tone: 1 | 2 | 3 | 4 | 5 | 6;
  connectionId?: string;
  unavailable?: boolean;
}

export interface RoutingConnection {
  id: string;
  name: string;
  tier?: string;
  quota?: { fiveHour: number | null; week: number | null };
  unavailable?: boolean;
}

interface Wire {
  key: string;
  d: string;
  tone: RoutingJob['tone'];
}

const UNAVAILABLE_NODE =
  'border-dashed bg-transparent shadow-none [border-color:color-mix(in_oklab,var(--destructive)_45%,transparent)]';

function UnavailableTag() {
  const { t } = useI18n();
  return (
    <span className="ml-auto rounded-sm bg-danger-soft px-1.5 py-px text-caption font-medium text-destructive">
      {t('不可用')}
    </span>
  );
}

function Dot({ side, className, ...props }: { side: 'left' | 'right' } & ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute top-[calc(50%-3px)] size-1.5 rounded-full bg-content-tertiary',
        side === 'right' ? '-right-0.75' : '-left-0.75',
        className,
      )}
      {...props}
    />
  );
}

function JobNode({ job }: { job: RoutingJob }) {
  const { t } = useI18n();
  const off = job.unavailable === true;
  return (
    <div
      data-slot="routing-node"
      data-unavailable={off ? '' : undefined}
      className={cn('relative rounded-lg border bg-card text-meta', off && UNAVAILABLE_NODE)}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 px-2.5 pt-1.75 pb-1.5 font-semibold',
          off ? 'text-content-tertiary' : 'text-foreground',
        )}
      >
        {job.name}
        {off && <UnavailableTag />}
      </div>
      <div className="flex items-center justify-between border-t border-border px-2.5 pt-1.5 pb-1.75 text-content-secondary">
        <span>{t('模型')}</span>
        <span
          className={cn('font-mono text-code', off ? 'text-content-tertiary' : 'text-foreground')}
        >
          {job.model}
        </span>
      </div>
      {!off && <Dot side="right" data-wire-out={job.id} />}
    </div>
  );
}

function ConnectionNode({ connection }: { connection: RoutingConnection }) {
  const { t } = useI18n();
  const off = connection.unavailable === true;
  return (
    <div
      data-slot="routing-node"
      data-unavailable={off ? '' : undefined}
      className={cn('relative rounded-lg border bg-card text-meta', off && UNAVAILABLE_NODE)}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 px-2.5 pt-1.75 pb-1.5 font-semibold',
          off ? 'text-content-tertiary' : 'text-foreground',
        )}
      >
        {connection.name}
        {off ? (
          <UnavailableTag />
        ) : (
          connection.tier != null && (
            <span className="ml-auto font-normal text-content-tertiary">{connection.tier}</span>
          )
        )}
      </div>
      {!off && connection.quota != null && (
        <div className="px-2.5 pb-2">
          {connection.quota.fiveHour !== null && (
            <QuotaRow name={connection.name} label="5h" left={connection.quota.fiveHour} />
          )}
          {connection.quota.week !== null && (
            <QuotaRow name={connection.name} label={t('周')} left={connection.quota.week} />
          )}
        </div>
      )}
      {!off && <Dot side="left" data-wire-in={connection.id} className="bg-(--text-dim)" />}
    </div>
  );
}

export function RoutingGraph({
  jobs,
  connections,
}: {
  jobs: RoutingJob[];
  connections: RoutingConnection[];
}) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<Wire[]>([]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box == null) return;
    const draw = () => {
      const origin = box.getBoundingClientRect();
      const next: Wire[] = [];
      for (const job of jobs) {
        if (job.unavailable === true || job.connectionId == null) continue;
        const from = box.querySelector(`[data-wire-out="${job.id}"]`);
        const to = box.querySelector(`[data-wire-in="${job.connectionId}"]`);
        if (from == null || to == null) continue;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const x1 = a.left + a.width / 2 - origin.left;
        const y1 = a.top + a.height / 2 - origin.top;
        const x2 = b.left + b.width / 2 - origin.left;
        const y2 = b.top + b.height / 2 - origin.top;
        const mid = (x1 + x2) / 2;
        next.push({
          key: job.id,
          d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
          tone: job.tone,
        });
      }
      setWires(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [jobs, connections]);

  return (
    <div
      ref={boxRef}
      data-slot="routing-graph"
      className="relative grid grid-cols-[minmax(0,14.5rem)_minmax(2rem,1fr)_minmax(0,14.5rem)] gap-y-2.5"
    >
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {wires.map((wire) => (
          <path
            key={wire.key}
            d={wire.d}
            fill="none"
            strokeWidth={1.75}
            style={{ stroke: 'var(--text-tertiary)' }}
          />
        ))}
      </svg>
      <div className="col-start-1 flex flex-col gap-2.5">
        <div className="text-caption font-medium text-content-tertiary">{t('用途')}</div>
        {jobs.map((job) => (
          <JobNode key={job.id} job={job} />
        ))}
      </div>
      <div className="col-start-3 flex flex-col justify-center gap-2.5">
        <div className="text-caption font-medium text-content-tertiary">{t('连接')}</div>
        {connections.map((connection) => (
          <ConnectionNode key={connection.id} connection={connection} />
        ))}
      </div>
    </div>
  );
}
