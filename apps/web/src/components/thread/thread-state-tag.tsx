import type { ReactNode } from 'react';
import type { StoneTone } from '../stone/tone.js';
import { StatusChip, type StatusTone } from '../ui/status-chip.js';

const CHIP_TONE: Record<StoneTone, StatusTone> = {
  waiting: 'confirm',
  review: 'plan',
  working: 'done',
  idle: 'idle',
  resolved: 'idle',
};

export function ThreadStateTag({ tone, children }: { tone: StoneTone; children: ReactNode }) {
  return (
    <StatusChip tone={CHIP_TONE[tone]} className="text-caption">
      {children}
    </StatusChip>
  );
}
