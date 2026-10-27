import { PLAN_SECTIONS } from '@cairn/shared';
import { expect, test } from 'vitest';
import { mapPlanDoc } from '../src/api/mappers.js';

test('plan labels still render through the protected shared section binding', () => {
  expect(Object.isFrozen(PLAN_SECTIONS)).toBe(true);
  const blocks = mapPlanDoc('Context: Existing context\n\nVerification: pnpm test');
  expect(blocks.map((block) => block.kind)).toEqual(['head', 'para', 'head', 'para']);
});
