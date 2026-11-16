import type { DailyUsageDay } from '@cairn/shared';
import { shiftDay } from '../usage/usage-model.js';

export function usageFixtureDays(today: string, count = 90): DailyUsageDay[] {
  let seed = 20261116;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const days: DailyUsageDay[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const ramp = 0.35 + 0.65 * (1 - back / count);
    const skip = next() < 0.18;
    const coordinator = Math.round((0.12 + next() * 1.5) * 1e6 * ramp);
    const tasks = next() < 0.2 ? 0 : Math.round(next() * next() * 3.4e6 * ramp);
    if (!skip) days.push({ date: shiftDay(today, -back), coordinator, tasks });
  }
  return days;
}
