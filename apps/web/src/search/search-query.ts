import {
  type ParsedSearchFilter,
  parseSearchQuery,
  SEARCH_FILTER_KEYS,
  SEARCH_IS_STATES,
  type SearchFilterResult,
} from '@cairn/shared';

export type ChipProblem = NonNullable<ParsedSearchFilter['problem'] | SearchFilterResult['reason']>;

export interface QuerySplit {
  chips: ParsedSearchFilter[];
  text: string;
}

function trailingTokenBounds(query: string): { start: number; inQuote: boolean } {
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i] as string;
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && /\s/.test(ch)) start = i + 1;
  }
  return { start, inQuote };
}

export function endsInFilter(text: string, nowMs: number): boolean {
  if (text === '' || /\s$/.test(text)) return false;
  const { start, inQuote } = trailingTokenBounds(text);
  return !inQuote && parseSearchQuery(text.slice(start), nowMs).filters.length === 1;
}

export function splitQuery(query: string, nowMs: number): QuerySplit {
  const { start } = trailingTokenBounds(query);
  const head = query.slice(0, start);
  const trailing = query.slice(start);
  const parsed = parseSearchQuery(head, nowMs);
  const words = parsed.words.map(
    (word) => `${word.negated ? '-' : ''}${/\s/.test(word.text) ? `"${word.text}"` : word.text}`,
  );
  const parts = trailing === '' ? words : [...words, trailing];
  const text = parts.join(' ') + (trailing === '' && words.length > 0 ? ' ' : '');
  return { chips: parsed.filters, text };
}

export function joinQuery(chips: readonly ParsedSearchFilter[], text: string): string {
  const head = chips.map((chip) => chip.raw).join(' ');
  if (head === '') return text;
  return `${head} ${text}`;
}

export function removeChipAt(
  chips: readonly ParsedSearchFilter[],
  index: number,
): ParsedSearchFilter[] {
  return chips.filter((_, i) => i !== index);
}

export function completeTrailingToken(text: string): string | null {
  const { start } = trailingTokenBounds(text);
  const head = text.slice(0, start);
  const trailing = text.slice(start);
  const negated = trailing.startsWith('-');
  const body = negated ? trailing.slice(1) : trailing;
  if (body === '') return null;
  const dash = negated ? '-' : '';
  const colon = body.indexOf(':');
  if (colon === -1) {
    const lower = body.toLowerCase();
    const key =
      SEARCH_FILTER_KEYS.find((candidate) => candidate === lower) ??
      SEARCH_FILTER_KEYS.find((candidate) => candidate.startsWith(lower));
    return key === undefined ? null : `${head}${dash}${key}:`;
  }
  if (body.slice(0, colon).toLowerCase() !== 'is') return null;
  const value = body.slice(colon + 1).toLowerCase();
  const state = SEARCH_IS_STATES.find((candidate) => candidate.startsWith(value));
  if (state === undefined || state === value) return null;
  return `${head}${dash}is:${state}`;
}

export function chipProblem(
  chip: ParsedSearchFilter,
  serverFilters: readonly SearchFilterResult[] | undefined,
): ChipProblem | null {
  if (chip.problem !== null) return chip.problem;
  const answered = serverFilters?.find((filter) => filter.raw === chip.raw && !filter.valid);
  return answered?.reason ?? null;
}

export const SYNTAX_ROWS = [
  {
    key: 'is:',
    meaning: '状态：failed、waiting、review、running、done、snoozed',
    example: 'is:failed',
  },
  { key: 'project:', meaning: '项目名', example: 'project:cairn' },
  { key: 'pr:', meaning: 'PR 编号，或 any', example: 'pr:2271' },
  { key: 'by:', meaning: '发起它的 agent 或成员', example: 'by:builder' },
  { key: 'after:', meaning: '日期，或距今的时间段', example: 'after:7d' },
  { key: 'cost:', meaning: '花费，用 > 或 <', example: 'cost:>5' },
] as const;

export const CHIP_PROBLEM_COPY: Record<ChipProblem, string> = {
  empty: '这个筛选还没有值',
  unknown_state: '状态只能是 failed、waiting、review、running、done 或 snoozed',
  bad_pr: '请写 PR 编号，或 any',
  bad_date: '请写日期如 2026-11-01，或时间段如 7d',
  bad_cost: '请写 > 或 < 加数字，如 >5',
  unknown_project: '没有这个名字的项目',
  unknown_person: '没有这个名字的 agent 或成员',
};
