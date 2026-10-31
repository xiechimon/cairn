import { ToneGlyph } from '../stone/tone-glyph.js';
import { StatusChip } from '../ui/status-chip.js';

export function WaitPill({ count }: { count: number }) {
  return (
    <StatusChip tone="confirm" className="h-5.5 gap-1.5 rounded-full px-2 text-meta">
      <ToneGlyph tone="waiting" className="size-3" />
      {count} waiting on you
    </StatusChip>
  );
}
