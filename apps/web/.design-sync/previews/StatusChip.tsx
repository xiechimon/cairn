import { StatusChip } from '@cairn/web';

export const Tones = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <StatusChip tone="idle">Queued</StatusChip>
    <StatusChip tone="plan">Planning</StatusChip>
    <StatusChip tone="confirm">Needs review</StatusChip>
    <StatusChip tone="done">Merged</StatusChip>
    <StatusChip tone="failed">Failed</StatusChip>
  </div>
);
