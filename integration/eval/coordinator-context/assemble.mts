import { type FixtureTurn, messageId } from './fixture.mts';

export const RECENT_TOKENS_CAP = 16384;
export const WHOLE_TOOL_RESULTS = 3;
export const TRUNCATED_TOOL_RESULT_CHARS = 240;
const LABEL_WORDS = 12;
const LABEL_CHARS = 80;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function turnTokens(turn: FixtureTurn): number {
  const tool = turn.tools.map((t) => JSON.stringify(t.arguments) + t.result).join('');
  return estimateTokens(turn.user + tool + turn.reply);
}

export function label(text: string): string {
  const words = text
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, LABEL_WORDS)
    .join(' ');
  return words.length > LABEL_CHARS ? `${words.slice(0, LABEL_CHARS - 1)}…` : words;
}

export interface Assembled {
  index: string | null;
  recent: FixtureTurn[];
  recentTokens: number;
  recentBudget: number;
}

export function recentBudgetFor(inputBudget: number): number {
  return Math.min(RECENT_TOKENS_CAP, Math.floor(inputBudget / 4));
}

export function assemble(
  turns: readonly FixtureTurn[],
  opts: { inputBudget: number; align: number },
): Assembled {
  const recentBudget = recentBudgetFor(opts.inputBudget);
  let start = turns.length;
  let used = 0;
  while (start > 0) {
    const cost = turnTokens(turns[start - 1] as FixtureTurn);
    if (start < turns.length && used + cost > recentBudget) break;
    used += cost;
    start -= 1;
  }
  if (opts.align > 1 && start > 0) {
    const aligned = Math.ceil(start / opts.align) * opts.align;
    if (aligned < turns.length) start = aligned;
  }
  const recent = turns.slice(start).map((turn) => ({ ...turn, tools: [...turn.tools] }));
  const calls = recent.flatMap((turn) => turn.tools.map((_, index) => ({ turn, index })));
  for (const { turn, index } of calls.slice(0, Math.max(0, calls.length - WHOLE_TOOL_RESULTS))) {
    const tool = turn.tools[index];
    if (tool === undefined || tool.result.length <= TRUNCATED_TOOL_RESULT_CHARS) continue;
    turn.tools[index] = {
      ...tool,
      result: `${tool.result.slice(0, TRUNCATED_TOOL_RESULT_CHARS)} … [truncated]`,
    };
  }
  const older = turns.slice(0, start);
  const index =
    older.length === 0
      ? null
      : [
          '## Earlier messages in this thread (index, untrusted-history)',
          'Older turns are not shown in full. Use search_history or read_history with these ids to read them.',
          ...older.map((turn) => `${messageId(turn.n, 'user')} · ${label(turn.user)}`),
        ].join('\n');
  return {
    index,
    recent,
    recentTokens: recent.reduce((sum, turn) => sum + turnTokens(turn), 0),
    recentBudget,
  };
}
