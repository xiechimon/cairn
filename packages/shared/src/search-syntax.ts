export const SEARCH_FILTER_KEYS = ['is', 'project', 'pr', 'by', 'after', 'cost'] as const;
export type SearchFilterKey = (typeof SEARCH_FILTER_KEYS)[number];

export const SEARCH_IS_STATES = [
  'failed',
  'waiting',
  'review',
  'running',
  'done',
  'snoozed',
] as const;
export type SearchIsState = (typeof SEARCH_IS_STATES)[number];

export type SearchFilterProblem = 'empty' | 'unknown_state' | 'bad_pr' | 'bad_date' | 'bad_cost';

export type SearchFilterCondition =
  | { key: 'is'; state: SearchIsState }
  | { key: 'project'; name: string }
  | { key: 'pr'; number: number | 'any' }
  | { key: 'by'; name: string }
  | { key: 'after'; sinceMs: number }
  | { key: 'cost'; op: '>' | '<'; dollars: number };

export interface ParsedSearchFilter {
  key: SearchFilterKey;
  raw: string;
  value: string;
  negated: boolean;
  condition: SearchFilterCondition | null;
  problem: SearchFilterProblem | null;
}

export interface SearchWord {
  text: string;
  negated: boolean;
}

export interface ParsedSearchQuery {
  filters: ParsedSearchFilter[];
  words: SearchWord[];
}

interface RawToken {
  raw: string;
  text: string;
  negated: boolean;
  keyEnd: number | null;
}

const FILTER_KEY_SET: ReadonlySet<string> = new Set(SEARCH_FILTER_KEYS);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RELATIVE_RE = /^(\d+)([dh])$/i;
const COST_RE = /^([<>])(\d+(?:\.\d+)?)$/;
const PR_RE = /^\d+$/;
const MS_PER_UNIT = { d: 86_400_000, h: 3_600_000 } as const;

function scanTokens(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i] as string)) {
      i += 1;
      continue;
    }
    const start = i;
    let negated = false;
    if (input[i] === '-' && i + 1 < input.length && !/\s/.test(input[i + 1] as string)) {
      negated = true;
      i += 1;
    }
    let text = '';
    let inQuote = false;
    let quoteSeen = false;
    let keyEnd: number | null = null;
    while (i < input.length && (inQuote || !/\s/.test(input[i] as string))) {
      const ch = input[i] as string;
      if (ch === '"') {
        inQuote = !inQuote;
        quoteSeen = true;
      } else {
        if (ch === ':' && !inQuote && !quoteSeen && keyEnd === null) keyEnd = text.length;
        text += ch;
      }
      i += 1;
    }
    tokens.push({ raw: input.slice(start, i), text, negated, keyEnd });
  }
  return tokens;
}

function conditionFor(
  key: SearchFilterKey,
  value: string,
  nowMs: number,
): { condition: SearchFilterCondition | null; problem: SearchFilterProblem | null } {
  if (value === '') return { condition: null, problem: 'empty' };
  switch (key) {
    case 'is': {
      const state = SEARCH_IS_STATES.find((s) => s === value.toLowerCase());
      return state
        ? { condition: { key, state }, problem: null }
        : { condition: null, problem: 'unknown_state' };
    }
    case 'project':
      return { condition: { key, name: value }, problem: null };
    case 'by':
      return { condition: { key, name: value }, problem: null };
    case 'pr': {
      if (value.toLowerCase() === 'any')
        return { condition: { key, number: 'any' }, problem: null };
      if (!PR_RE.test(value) || Number(value) < 1) return { condition: null, problem: 'bad_pr' };
      return { condition: { key, number: Number(value) }, problem: null };
    }
    case 'after': {
      const relative = RELATIVE_RE.exec(value);
      if (relative) {
        const unit = (relative[2] as string).toLowerCase() as 'd' | 'h';
        return {
          condition: { key, sinceMs: nowMs - Number(relative[1]) * MS_PER_UNIT[unit] },
          problem: null,
        };
      }
      const date = DATE_RE.exec(value);
      if (date) {
        const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
        const at = new Date(Date.UTC(year, month - 1, day));
        const real =
          at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
        if (real) return { condition: { key, sinceMs: at.getTime() }, problem: null };
      }
      return { condition: null, problem: 'bad_date' };
    }
    case 'cost': {
      const cost = COST_RE.exec(value);
      if (!cost) return { condition: null, problem: 'bad_cost' };
      return {
        condition: { key, op: cost[1] as '>' | '<', dollars: Number(cost[2]) },
        problem: null,
      };
    }
  }
}

export function parseSearchQuery(input: string, nowMs: number): ParsedSearchQuery {
  const filters: ParsedSearchFilter[] = [];
  const words: SearchWord[] = [];
  for (const token of scanTokens(input)) {
    const key = token.keyEnd === null ? null : token.text.slice(0, token.keyEnd).toLowerCase();
    if (key !== null && FILTER_KEY_SET.has(key)) {
      const value = token.text.slice((token.keyEnd as number) + 1).trim();
      const filterKey = key as SearchFilterKey;
      filters.push({
        key: filterKey,
        raw: token.raw,
        value,
        negated: token.negated,
        ...conditionFor(filterKey, value, nowMs),
      });
    } else if (token.text !== '') {
      words.push({ text: token.text, negated: token.negated });
    }
  }
  return { filters, words };
}
