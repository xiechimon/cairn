import { needsTimeDivider } from '../lib/message-time.js';
import { chiefRowShows } from './chief-row-kinds.js';
import { plainQuestionText } from './question-item.js';
import type { GroupedRow } from './thread-activity.js';

export interface BubbleRun {
  joinsPrev: boolean;
  joinsNext: boolean;
}

export interface BubbleRunOptions {
  cardFailure?: string | null;
  startedBy?: ReadonlyMap<GroupedRow['item'], readonly string[]>;
}

type Author = 'user' | 'robot' | null;

function opensAs(item: GroupedRow['item']): Author {
  if (item.kind === 'user') return 'user';
  if (item.kind === 'robot' || item.kind === 'chat-block') return 'robot';
  if (item.kind === 'question' && plainQuestionText(item) !== null) return 'robot';
  return null;
}

function opensWithLeadingChrome(
  item: GroupedRow['item'],
  startedBy: ReadonlyMap<GroupedRow['item'], readonly string[]> | undefined,
): boolean {
  if (item.kind !== 'robot') return false;
  if ((startedBy?.get(item)?.length ?? 0) > 0) return true;
  return (item.tools ?? []).some((tool) => tool.subagent !== undefined);
}

export function bubbleRuns(
  rows: readonly GroupedRow[],
  previousAt: number | null,
  options?: BubbleRunOptions,
): BubbleRun[] {
  const cardFailure = options?.cardFailure ?? null;
  const startedBy = options?.startedBy;
  const runs: BubbleRun[] = rows.map(() => ({ joinsPrev: false, joinsNext: false }));
  let clock = previousAt;
  let prevVisibleIdx = -1;
  for (let n = 0; n < rows.length; n += 1) {
    const entry = rows[n];
    if (entry === undefined) continue;
    const { item } = entry;
    if (!chiefRowShows(item, cardFailure)) continue;
    const at = 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : null;
    const divided = at !== null && needsTimeDivider(clock, at);
    if (at !== null) clock = at;
    const author = opensAs(item);
    const prevItem = prevVisibleIdx >= 0 ? rows[prevVisibleIdx]?.item : undefined;
    if (
      author !== null &&
      prevItem !== undefined &&
      opensAs(prevItem) === author &&
      !divided &&
      !opensWithLeadingChrome(item, startedBy)
    ) {
      const prevRun = runs[prevVisibleIdx];
      const currRun = runs[n];
      if (prevRun !== undefined) prevRun.joinsNext = true;
      if (currRun !== undefined) currRun.joinsPrev = true;
    }
    prevVisibleIdx = n;
  }
  return runs;
}
