import type { TFunc } from '../i18n/translate.js';
import { dateTimeFormat, formatClockTime } from '../lib/date-format.js';
import { chiefRowShows } from './chief-row-kinds.js';
import type { GroupedRow } from './thread-activity.js';

export const TIME_DIVIDER_GAP_MS = 10 * 60 * 1000;

export function needsTimeDivider(previousAt: number | null, at: number): boolean {
  return previousAt !== null && at - previousAt > TIME_DIVIDER_GAP_MS;
}

type StreamItem = GroupedRow['item'];

const isReply = (item: StreamItem | null) => item?.kind === 'robot';

export function streamDividers(
  rows: readonly GroupedRow[],
  previousAt: number | null,
  cardFailure: string | null,
  now: number = Date.now(),
): { dividers: (number | null)[]; lastAt: number | null } {
  let lastAt = previousAt;
  let shown: StreamItem | null = null;
  const dividers = rows.map(({ item }) => {
    if (!chiefRowShows(item, cardFailure)) return null;
    const at = 'createdAt' in item && typeof item.createdAt === 'number' ? item.createdAt : null;
    const splitsReplies = isReply(item) && isReply(shown);
    shown = item;
    if (at === null) return splitsReplies ? now : null;
    const divider = splitsReplies || needsTimeDivider(lastAt, at) ? at : null;
    lastAt = at;
    return divider;
  });
  return { dividers, lastAt };
}

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

const daysBetween = (at: number, now: number) =>
  Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);

export function messageStampLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  return daysBetween(at, now) === 0
    ? formatClockTime(at, locale)
    : timeDividerLabel(at, now, locale, t);
}

export function timeDividerLabel(at: number, now: number, locale: 'zh' | 'en', t: TFunc): string {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const time = formatClockTime(at, locale);
  const days = daysBetween(at, now);
  if (days === 0) return t('今天 {time}', { time });
  if (days === 1) return t('昨天 {time}', { time });
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = dateTimeFormat(tag, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(at);
  return `${date} ${time}`;
}
