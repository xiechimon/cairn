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

const featurePlan = (decision: string, extra = '') => `## Context
Kind: feature
${extra}
## Prior art
- Source: https://github.com/hexagon/croner
${decision}
## Changes
- Implement the selected scheduler.
## Verification
- Run pnpm lint.
`;

describe('prior-art decision scoring', () => {
  test.each([
    'Decision: do not reuse croner because we will build a hand-written parser.',
    'Decision: never reuse croner because we will build a hand-written parser.',
    '决策：不复用 croner，因为要手写解析器。',
    'Decision: reuse croner because it is maintained; do not reuse croner in the final implementation.',
    "Decision: reuse croner because it is maintained; don't reuse croner in the final implementation.",
    'Source: a rejected example; reuse croner because it is maintained.\nDecision: build a parser because the example is unsuitable.',
    'Decision: we will not reuse croner because we will build a hand-written parser.',
    'Decision: build a hand-written parser because the croner reuse example is unsuitable.',
    'Decision: reuse another-library because it is maintained; croner is only a reference.',
    '> Decision: reuse croner because it is maintained.\nDecision: build a parser because the example is unsuitable.',
    '```text\nDecision: reuse croner because it is maintained.\n```\nDecision: build a parser because the example is unsuitable.',
  ])('does not award reuse credit to %s', (decision) => {
    expect(gradePlanPriorArt(featurePlan(decision)).score).toBe(0.5);
  });

  test('ignores reuse claims outside the prior-art decision', () => {
    expect(
      gradePlanPriorArt(
        featurePlan(
          'Decision: build a parser because the library is unsuitable.',
          'An earlier proposal said to reuse croner.',
        ),
      ).score,
    ).toBe(0.5);
  });

  test.each([
    'Decision: reuse `croner` because it is maintained.',
    '决策：复用 croner，因为仍在维护。',
    'Decision: we will reuse croner rather than build a parser.',
    'Reuse croner because it is maintained.',
    'Decision: do not hand-roll; reuse croner because it is maintained.',
  ])('preserves affirmative reuse credit for %s', (decision) => {
    expect(gradePlanPriorArt(featurePlan(decision)).score).toBe(1);
  });
});

test('a prior-art heading inside a fenced example cannot satisfy the feature contract', () => {
  const example = [
    'Kind: feature',
    '```markdown',
    '## Prior art',
    '- Source: https://github.com/hexagon/croner',
    '- Decision: reuse croner because it is maintained.',
    '```',
    '## Verification',
    '- Run pnpm lint.',
  ].join('\n');
  expect(gradePlanPriorArt(example).score).toBe(0);
});

test.each([
  'Decision: reuse croner is rejected because we will build our own parser.',
  'Decision: reuse croner because it is maintained.\nDecision: build our own parser instead because croner cannot support our calendar.',
  'Decision: reuse croner because it is maintained; build our own parser instead because croner cannot support our calendar.',
  '决策：复用 croner 被否决，因为需要手写解析器。',
])('rejected or conflicting choices cannot receive full credit: %s', (decision) => {
  expect(gradePlanPriorArt(featurePlan(decision)).score).toBe(0.5);
});
