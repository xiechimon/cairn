import { Pebble } from '../stone/pebble.js';
import { StatusChip } from '../ui/status-chip.js';

export function WaitPill({ count }: { count: number }) {
  return (
    <StatusChip tone="confirm" className="h-5.5 gap-1.5 rounded-full px-2 text-meta">
      <Pebble tone="waiting" />
      {count} waiting on you
    </StatusChip>
  );
}
