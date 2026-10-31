import { cn } from 'cn';
import { StatusChip } from '../ui/status-chip.js';
import { QuotaBar } from './quota-bar.js';

export interface RoutingNodeProps {
  name: string;
  detail: string;
  note?: string;
  unavailable?: boolean;
  quota?: { fiveHour: number; week: number };
  className?: string;
}

export function RoutingNode({
  name,
  detail,
  note,
  unavailable = false,
  quota,
  className,
}: RoutingNodeProps) {
  const hot = quota != null && Math.max(quota.fiveHour, quota.week) >= 80;
  return (
    <div
      data-slot="routing-node"
      data-unavailable={unavailable ? '' : undefined}
      className={cn(
        'rounded-(--radius-control) bg-card px-2.5 py-2 text-meta shadow-(--e1)',
        unavailable && 'border border-dashed border-danger-line opacity-70',
        className,
      )}
    >
      <b className="flex items-center gap-1.5 text-ui font-semibold text-foreground">
        {name}
        {unavailable && (
          <StatusChip tone="failed" className="h-4 text-caption">
            Unavailable
          </StatusChip>
        )}
      </b>
      <span className="block font-mono text-caption text-content-tertiary">{detail}</span>
      {note != null && (
        <span className="block font-mono text-caption text-(--chip-confirm-fg)">{note}</span>
      )}
      {quota != null && (
        <>
          <QuotaBar percent={quota.fiveHour} hot={hot} label={`${name} five-hour quota`} />
          <span className="block font-mono text-caption text-content-tertiary">
            5h {quota.fiveHour}% · week {quota.week}%
          </span>
        </>
      )}
    </div>
  );
}
