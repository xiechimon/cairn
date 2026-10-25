export interface CompletionTriggerSpec {
  trigger: string;
  tokenClass: string;
  boundaryClass?: string;
}

export interface CompletionRange {
  start: number;
  end: number;
  query: string;
}

const DEFAULT_BOUNDARY_CLASS = '\\s。、？！';

const COMPILED = new WeakMap<CompletionTriggerSpec, RegExp>();

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function specRegex(spec: CompletionTriggerSpec): RegExp {
  let re = COMPILED.get(spec);
  if (re === undefined) {
    const boundary = spec.boundaryClass ?? DEFAULT_BOUNDARY_CLASS;
    re = new RegExp(
      `(^|[${boundary}])${escapeForRegex(spec.trigger)}([${spec.tokenClass}]*)$`,
      'u',
    );
    COMPILED.set(spec, re);
  }
  return re;
}

export function detectCompletionToken(
  value: string,
  caret: number,
  spec: CompletionTriggerSpec,
): CompletionRange | null {
  if (caret <= 0 || caret > value.length) return null;
  const match = specRegex(spec).exec(value.slice(0, caret));
  if (match === null) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, end: caret, query };
}

export const MENTION_COMPLETION_SPEC: CompletionTriggerSpec = {
  trigger: '@',
  tokenClass: '\\p{L}\\p{N}\\p{M}_\\-./\\\\()[\\]~:',
};

export const COMPLETION_CAP = 15;

const SEPARATORS = new Set(['/', '\\', '-', '_', '.', ' ']);

const RUN_BONUS = 2;
const SEPARATOR_BONUS = 8;
const CAMEL_BONUS = 6;

function isCamelBoundary(raw: string, idx: number): boolean {
  if (idx <= 0) return false;
  const prev = raw[idx - 1] ?? '';
  const cur = raw[idx] ?? '';
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur === cur.toUpperCase();
}

function subsequenceScore(query: string, folded: string, raw: string): number | null {
  let score = 0;
  let from = 0;
  let prevIdx = -2;
  for (let i = 0; i < query.length; i += 1) {
    const idx = folded.indexOf(query[i] ?? '', from);
    if (idx === -1) return null;
    score += 1;
    if (idx === 0 || SEPARATORS.has(raw[idx - 1] ?? '')) score += SEPARATOR_BONUS;
    else if (isCamelBoundary(raw, idx)) score += CAMEL_BONUS;
    if (idx === prevIdx + 1) score += RUN_BONUS;
    prevIdx = idx;
    from = idx + 1;
  }
  return score;
}

export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  labelOf: (item: T) => string,
  cap: number = COMPLETION_CAP,
): T[] {
  if (query === '') return items.slice(0, cap);
  const caseSensitive = query !== query.toLowerCase();
  const q = caseSensitive ? query : query.toLowerCase();
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const raw = labelOf(item);
    const folded = caseSensitive ? raw : raw.toLowerCase();
    const score = subsequenceScore(q, folded, raw);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap).map((entry) => entry.item);
}

export function cycleHighlight(current: number | null, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  if (current === null || current < 0 || current >= count) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

export type CompletionKeyIntent =
  | { kind: 'navigate'; index: number }
  | { kind: 'accept'; index: number }
  | { kind: 'dismiss' }
  | { kind: 'ignore' };

export interface CompletionKeyEvent {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
}

export interface CompletionNavState {
  open: boolean;
  highlight: number | null;
  matchCount: number;
}

export function completionKeyIntent(
  event: CompletionKeyEvent,
  state: CompletionNavState,
): CompletionKeyIntent {
  if (event.isComposing === true) return { kind: 'ignore' };
  if (!state.open) return { kind: 'ignore' };
  switch (event.key) {
    case 'Escape':
      return { kind: 'dismiss' };
    case 'ArrowDown':
      return state.matchCount === 0
        ? { kind: 'ignore' }
        : { kind: 'navigate', index: cycleHighlight(state.highlight, 1, state.matchCount) };
    case 'ArrowUp':
      return state.matchCount === 0
        ? { kind: 'ignore' }
        : { kind: 'navigate', index: cycleHighlight(state.highlight, -1, state.matchCount) };
    case 'Tab':
      return state.matchCount === 0
        ? { kind: 'ignore' }
        : { kind: 'accept', index: state.highlight ?? 0 };
    case 'Enter':
      if (event.shiftKey === true) return { kind: 'ignore' };
      return state.highlight !== null && state.highlight < state.matchCount
        ? { kind: 'accept', index: state.highlight }
        : { kind: 'ignore' };
    default:
      return { kind: 'ignore' };
  }
}
