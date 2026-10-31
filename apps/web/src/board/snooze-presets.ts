export type SnoozeChoice = 'needed' | 'tomorrow-09:00' | 'next-monday' | 'pick';

export type SnoozeRequest = 'needed' | 'tomorrow-09:00' | 'next-monday' | number;

const PRESET_HOUR = 9;
const MONDAY = 1;

export function presetInstant(choice: 'tomorrow-09:00' | 'next-monday', now: number): number {
  const base = new Date(now);
  const daysAhead = choice === 'tomorrow-09:00' ? 1 : (MONDAY - base.getDay() + 7) % 7 || 7;
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + daysAhead,
    PRESET_HOUR,
    0,
    0,
    0,
  ).getTime();
}

export function localInputValue(epoch: number): string {
  const date = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
