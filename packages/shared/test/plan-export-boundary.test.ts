import { expect, test } from 'vitest';
import { planResponseSchema, planRowSchema } from '../src/records/plan.js';

const row = {
  id: 'plan-1',
  buildId: 'build-1',
  version: 1,
  content: 'Run verification',
  createdAt: 1002,
};

test('persisted plan parsing excludes live auto-approval controls', () => {
  expect(planRowSchema.parse({ ...row, autoApproveAt: 2000, autoApprovePausedAt: 1500 })).toEqual(
    row,
  );
});

test('plan responses retain live auto-approval controls', () => {
  const response = { ...row, autoApproveAt: 2000, autoApprovePausedAt: 1500 };
  expect(planResponseSchema.parse(response)).toEqual(response);
});
