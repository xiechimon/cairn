import { cn } from 'cn';
import { ACCENT_INK } from '../../phase.js';

export const LOW_QUOTA_LEFT_PERCENT = 20;

export const isLowQuota = (left: number | null) => left !== null && left <= LOW_QUOTA_LEFT_PERCENT;

export function QuotaRow({ label, left, name }: { label: string; left: number; name: string }) {
  const low = isLowQuota(left);
  const filled = Math.min(100, Math.max(0, left));
  return (
    <div className="grid h-4.5 grid-cols-[2.25rem_1fr_2rem] items-center gap-1.5 text-caption text-content-tertiary tabular-nums">
      <span>{label}</span>
      <div
        role="progressbar"
        aria-label={`${name} ${label} quota left`}
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={100}
        data-low={low ? '' : undefined}
        className="h-1 overflow-hidden rounded-full bg-secondary"
      >
        <i
          className={cn('block h-full rounded-full', low ? 'bg-pebble-waiting' : 'bg-running')}
          style={{ width: `${filled}%` }}
        />
      </div>
      <span className={cn('text-right', low && ACCENT_INK)}>{filled}%</span>
    </div>
  );
}
