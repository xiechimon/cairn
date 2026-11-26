import { needsTimeDivider } from '../lib/message-time.js';
import { chiefRowShows } from './chief-row-kinds.js';
import type { GroupedRow } from './thread-activity.js';

export function streamDividers(
  rows: readonly GroupedRow[],
  previousAt: number | null,
  cardFailure: string | null,
): { dividers: (number | null)[]; lastAt: number | null } {
  let lastAt = previousAt;
  const dividers = rows.map(({ item }) => {
    if (!chiefRowShows(item, cardFailure)) return null;
    const at = 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : null;
    if (at === null) return null;
    const divider = needsTimeDivider(lastAt, at) ? at : null;
    lastAt = at;
    return divider;
  });
  return { dividers, lastAt };
}
