import { describe, expect, test } from 'vitest';
import {
  assemble,
  recentBudgetFor,
  TRUNCATED_TOOL_RESULT_CHARS,
  turnTokens,
  WHOLE_TOOL_RESULTS,
} from '../eval/coordinator-context/assemble.mts';
import {
  buildFixture,
  RARE_FACT_TURN,
  RECALL_ANSWERS,
  recalled,
  SEEDED_TURNS,
} from '../eval/coordinator-context/fixture.mts';

const turns = buildFixture().slice(0, SEEDED_TURNS);

describe('the 500-turn Coordinator fixture', () => {
  test('is deterministic, names Kestrel and its ticket only at turn 20, and reuses its host as a distractor', () => {
    expect(buildFixture()).toEqual(buildFixture());
    const text = (t: (typeof turns)[number]) =>
      `${t.user}${t.reply}${t.tools.map((x) => x.result).join('')}`;
    const seeded = buildFixture().slice(0, SEEDED_TURNS);
    expect(seeded.filter((t) => /Kestrel|KST-/.test(text(t))).map((t) => t.n)).toEqual([
      RARE_FACT_TURN,
    ]);
    expect(seeded.filter((t) => text(t).includes(RECALL_ANSWERS[0])).length).toBeGreaterThan(5);
  });

  test('recall needs both values', () => {
    expect(recalled('host build-07, ticket KST-4471')).toBe(true);
    expect(recalled('host build-07')).toBe(false);
  });
});

describe('the retrieval assembler', () => {
  test.each([16000, 64000, 200000])(
    'recent turns stay under min(16384, budget/4) for budget %i',
    (budget) => {
      const out = assemble(turns, { inputBudget: budget, align: 1 });
      expect(out.recentBudget).toBe(recentBudgetFor(budget));
      expect(out.recentTokens).toBeLessThanOrEqual(out.recentBudget);
      expect(out.recent.at(-1)?.n).toBe(SEEDED_TURNS);
    },
  );

  test('every older turn is in the index, in order, and none is in both', () => {
    const out = assemble(turns, { inputBudget: 64000, align: 1 });
    const first = out.recent[0]?.n ?? 0;
    const ids = (out.index ?? '').split('\n').filter((l) => l.startsWith('m-'));
    expect(ids).toHaveLength(first - 1);
    expect(ids[0]?.startsWith('m-0001-user')).toBe(true);
    expect(ids.at(-1)?.startsWith(`m-${String(first - 1).padStart(4, '0')}-user`)).toBe(true);
  });

  test('only the last three tool results stay whole', () => {
    const out = assemble(turns, { inputBudget: 64000, align: 1 });
    const results = out.recent.flatMap((t) => t.tools.map((x) => x.result));
    const whole = results.slice(-WHOLE_TOOL_RESULTS);
    const older = results.slice(0, -WHOLE_TOOL_RESULTS);
    expect(whole.every((r) => !r.endsWith(' … [truncated]'))).toBe(true);
    expect(
      older.every((r) => r.length <= TRUNCATED_TOOL_RESULT_CHARS || r.endsWith(' … [truncated]')),
    ).toBe(true);
  });

  test('an aligned window moves its start only on a block boundary and stays under budget', () => {
    const starts = new Set<number>();
    for (let end = 400; end <= SEEDED_TURNS; end += 1) {
      const out = assemble(turns.slice(0, end), { inputBudget: 64000, align: 8 });
      const start = out.recent[0]?.n ?? 0;
      expect((start - 1) % 8).toBe(0);
      expect(out.recentTokens).toBeLessThanOrEqual(out.recentBudget);
      starts.add(start);
    }
    expect(starts.size).toBeLessThan(81 / 4);
  });

  test('a single turn larger than the budget is still kept', () => {
    const big = [{ ...turns[0], user: 'x'.repeat(200000) }] as typeof turns;
    expect(assemble(big, { inputBudget: 16000, align: 1 }).recent).toHaveLength(1);
    expect(turnTokens(big[0] as (typeof turns)[number])).toBeGreaterThan(16000);
  });
});
