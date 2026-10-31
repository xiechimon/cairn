import { cn } from 'cn';

export function QuotaBar({
  percent,
  hot = false,
  label,
}: {
  percent: number;
  hot?: boolean;
  label: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      data-hot={hot ? '' : undefined}
      className="mt-1.5 h-1.25 overflow-hidden rounded-sm bg-running-track"
    >
      <i
        className={cn('block h-full', hot ? 'bg-pebble-waiting' : 'bg-pebble-working')}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
