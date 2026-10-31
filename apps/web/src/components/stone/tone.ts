export type StoneTone = 'waiting' | 'review' | 'working' | 'idle' | 'resolved';

export const STONE_TONES: readonly StoneTone[] = [
  'waiting',
  'review',
  'working',
  'idle',
  'resolved',
];

export const PEBBLE_BG: Record<StoneTone, string> = {
  waiting: 'bg-pebble-waiting',
  review: 'bg-pebble-review',
  working: 'bg-pebble-working',
  idle: 'bg-pebble-idle',
  resolved: 'bg-pebble-resolved',
};
