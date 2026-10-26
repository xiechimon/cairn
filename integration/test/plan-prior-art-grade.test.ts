import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { gradePlanPriorArt } from '../eval/plan-prior-art/grade.mts';

const flow = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../.claude/hillclimb/plan-prior-art/cases.json'),
    'utf8',
  ),
) as {
  cases: { id: string; plan: string }[];
};

const plan = (id: string) => {
  const found = flow.cases.find((c) => c.id === id);
  if (found === undefined) throw new Error(`missing case ${id}`);
  return found.plan;
};

describe('plan prior-art eval (#1838)', () => {
  test('a hand-rolled cron parser with no citations scores lower than reusing croner', () => {
    const hand = gradePlanPriorArt(plan('cron-hand-roll'));
    const reuse = gradePlanPriorArt(plan('cron-reuse'));
    expect(hand.score).toBeLessThan(reuse.score);
    expect(reuse.score).toBe(1);
    expect(hand.explanation.length).toBeGreaterThan(0);
    expect(reuse.explanation.length).toBeGreaterThan(0);
  });
});
