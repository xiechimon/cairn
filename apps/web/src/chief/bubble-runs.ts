import type { GroupedRow } from './thread-activity.js';
import { needsTimeDivider } from './time-dividers.js';

export interface BubbleRun {
  joinsPrev: boolean;
  joinsNext: boolean;
}

type Author = 'user' | 'robot' | null;

function authorOf(item: GroupedRow['item']): Author {
  if (item.kind === 'user') return 'user';
  if (item.kind === 'robot') return 'robot';
  return null;
}

function opensWithTools(item: GroupedRow['item']): boolean {
  return item.kind === 'robot' && (item.tools?.length ?? 0) > 0;
}

export function bubbleRuns(rows: readonly GroupedRow[], previousAt: number | null): BubbleRun[] {
  let clock = previousAt;
  const joinsPrev = rows.map(({ item }, n) => {
    const at = 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : null;
    const divided = at !== null && needsTimeDivider(clock, at);
    if (at !== null) clock = at;
    const author = authorOf(item);
    const before = rows[n - 1]?.item;
    return (
      author !== null &&
      before !== undefined &&
      authorOf(before) === author &&
      !divided &&
      !opensWithTools(item)
    );
  });
  return joinsPrev.map((joins, n) => ({ joinsPrev: joins, joinsNext: joinsPrev[n + 1] === true }));
}
