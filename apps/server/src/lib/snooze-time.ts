import { SNOOZE_PRESETS, type SnoozeMode, type SnoozeUntil } from '@cairn/shared';
import { HttpError } from './errors.js';

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface ResolvedSnooze {
  mode: SnoozeMode;
  until: number | null;
}

const MORNING_HOUR = 8;
const PRESET_HOUR = 9;
const MONDAY = 1;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatterFor(tz: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
      hourCycle: 'h23',
    });
  } catch {
    throw new HttpError(400, `invalid time zone: ${tz}`);
  }
}

function wallTimeAt(epoch: number, tz: string): WallTime & { weekday: number; second: number } {
  const parts = formatterFor(tz).formatToParts(new Date(epoch));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

function offsetAt(epoch: number, tz: string): number {
  const wall = wallTimeAt(epoch, tz);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

export function zonedWallToEpoch(wall: WallTime, tz: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const firstGuess = naive - offsetAt(naive, tz);
  return naive - offsetAt(firstGuess, tz);
}

function dayShifted(wall: WallTime, days: number): WallTime {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

function presetInstant(preset: string, now: number, tz: string): number {
  const today = wallTimeAt(now, tz);
  const at = (days: number, hour: number) =>
    zonedWallToEpoch({ ...dayShifted(today, days), hour, minute: 0 }, tz);
  if (preset === 'tomorrow') {
    const thisMorning = at(0, MORNING_HOUR);
    return now < thisMorning ? thisMorning : at(1, MORNING_HOUR);
  }
  if (preset === 'tomorrow-09:00') return at(1, PRESET_HOUR);
  const daysAhead = (MONDAY - today.weekday + 7) % 7 || 7;
  return at(daysAhead, PRESET_HOUR);
}

export function resolveSnooze(
  until: SnoozeUntil | string,
  now: number,
  tz = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ResolvedSnooze {
  formatterFor(tz);
  if (until === 'needed') return { mode: 'needed', until: null };
  let instant: number;
  if (typeof until === 'number') instant = until;
  else if ((SNOOZE_PRESETS as readonly string[]).includes(until))
    instant = presetInstant(until, now, tz);
  else instant = /^\d{4}-\d{2}-\d{2}T/.test(until) ? Date.parse(until) : Number.NaN;
  if (!Number.isFinite(instant)) throw new HttpError(400, `invalid snooze until: ${String(until)}`);
  if (instant <= now) throw new HttpError(400, 'snooze until must be in the future');
  return { mode: 'until', until: Math.trunc(instant) };
}
