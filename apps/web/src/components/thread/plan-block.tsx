import { cn } from 'cn';

export type PlanItemStatus = 'pending' | 'now' | 'done';

export interface PlanItem {
  label: string;
  status: PlanItemStatus;
}

const STATUS_LABEL: Record<PlanItemStatus, string> = {
  pending: 'Pending',
  now: 'In progress',
  done: 'Done',
};

const RING: Record<PlanItemStatus, string> = {
  pending: 'border-[1.5px] border-dashed border-content-tertiary',
  now: 'border-[1.5px] border-pebble-working border-t-transparent animate-spin [animation-duration:1.2s] motion-reduce:animate-none',
  done: 'bg-pebble-working',
};

export function PlanBlock({
  items,
  className,
}: {
  items: readonly PlanItem[];
  className?: string;
}) {
  return (
    <ol
      data-slot="plan-block"
      className={cn(
        'm-0 flex list-none flex-col gap-1.5 rounded-xl bg-card px-3.5 py-2.5 shadow-(--e1)',
        className,
      )}
    >
      {items.map((item) => (
        <li
          key={item.label}
          data-status={item.status}
          className={cn(
            'flex items-baseline gap-2 text-ui',
            item.status === 'done' ? 'text-content-tertiary' : 'text-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-3.25 flex-none translate-y-0.5 rounded-full', RING[item.status])}
          />
          <span className="sr-only">{STATUS_LABEL[item.status]}: </span>
          {item.label}
        </li>
      ))}
    </ol>
  );
}
