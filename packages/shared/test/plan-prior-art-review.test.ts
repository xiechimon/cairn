import { describe, expect, test } from 'vitest';
import { checkPlanContract, planVerificationItems } from '../src/records/plan.js';

const verification = '## Verification\n- Run pnpm lint.';
const feature = `## Context
Add cron-style scheduling for todos.
## Changes
- Create apps/server/src/services/cron-schedule.ts and expose scheduling in the UI.
${verification}`;

describe('prior-art review controls', () => {
  test('an unclassified capability cannot bypass prior art by omitting trigger words', () => {
    const result = checkPlanContract(feature);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('Prior art');
  });

  test('an explicitly classified small fix remains exempt', () => {
    expect(
      checkPlanContract(`Kind: fix\n## Context\nFix a blank error banner.\n${verification}`).ok,
    ).toBe(true);
  });

  test('reading an old saved checklist does not discard its verification items', () => {
    expect(planVerificationItems(`## Context\nAn existing saved plan.\n${verification}`)).toEqual([
      'Run pnpm lint.',
    ]);
  });

  test.each([
    '- https://github.com/Hexagon/croner: a maintained library that supports reuse.',
    '- Source: https://github.com/Hexagon/croner because it is maintained and supports reuse.',
    '- Decision: the maintained croner library supports reuse.',
  ])('a description is not a decision: %s', (description) => {
    const result = checkPlanContract(`Kind: feature
## Prior art
- https://github.com/Hexagon/croner
${description}
${verification}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain('决策');
  });
});
