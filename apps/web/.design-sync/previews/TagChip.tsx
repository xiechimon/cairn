import { TagChip } from '@cairn/web';

export const Colors = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <TagChip tag={{ id: 't1', name: 'frontend', color: '#6366f1' }} />
    <TagChip tag={{ id: 't2', name: 'bug', color: '#dc2626' }} />
    <TagChip tag={{ id: 't3', name: 'merge-gate', color: '#059669' }} />
    <TagChip tag={{ id: 't4', name: 'daemon', color: '#d97706' }} />
  </div>
);

export const LongName = () => (
  <TagChip tag={{ id: 't5', name: 'needs-decision-before-merge', color: '#6366f1' }} />
);
