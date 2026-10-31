import { cn } from 'cn';

export interface StatItem {
  value: string;
  label: string;
}

export function StatStrip({
  items,
  className,
}: {
  items: readonly StatItem[];
  className?: string;
}) {
  return (
    <dl
      data-slot="stat-strip"
      className={cn(
        'm-0 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border shadow-(--e1)',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-card px-3 py-2.5">
          <dd className="m-0 truncate font-mono text-card-title font-medium text-foreground">
            {item.value}
          </dd>
          <dt className="truncate text-caption font-normal text-content-tertiary">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}
