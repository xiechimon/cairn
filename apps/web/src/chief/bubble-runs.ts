import { answerLines } from './question-lifecycle.js';
import type { GroupedRow } from './thread-activity.js';
import { needsTimeDivider } from './time-dividers.js';

export interface BubbleRun {
  joinsPrev: boolean;
  joinsNext: boolean;
}

type Author = 'user' | 'robot' | null;

function opensAs(item: GroupedRow['item']): Author {
  if (item.kind === 'user') return 'user';
  if (item.kind === 'robot') return 'robot';
  if (item.kind === 'question' && item.status === 'answered') return 'robot';
  return null;
}

function closesAs(item: GroupedRow['item']): Author {
  if (item.kind === 'question') return answerLines(item).length > 0 ? 'user' : null;
  return opensAs(item);
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
    const author = opensAs(item);
    const before = rows[n - 1]?.item;
    return (
      author !== null &&
      before !== undefined &&
      closesAs(before) === author &&
      !divided &&
      !opensWithTools(item)
    );
  });
  return joinsPrev.map((joins, n) => ({ joinsPrev: joins, joinsNext: joinsPrev[n + 1] === true }));
}
