import { cn } from 'cn';
import { ACCENT_INK } from '../../phase.js';

export const HOT_QUOTA_PERCENT = 80;

export function QuotaRow({
  label,
  percent,
  name,
}: {
  label: string;
  percent: number;
  name: string;
}) {
  const hot = percent >= HOT_QUOTA_PERCENT;
  return (
    <div className="grid h-4.5 grid-cols-[2.25rem_1fr_2rem] items-center gap-1.5 text-caption text-content-tertiary tabular-nums">
      <span>{label}</span>
      <div
        role="progressbar"
        aria-label={`${name} ${label} quota`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        data-hot={hot ? '' : undefined}
        className="h-1 overflow-hidden rounded-full bg-secondary"
      >
        <i
          className={cn('block h-full rounded-full', hot ? 'bg-pebble-waiting' : 'bg-running')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={cn('text-right', hot && ACCENT_INK)}>{percent}%</span>
    </div>
  );
}
