import { describe, expect, test } from 'vitest';
import {
  ACTIVE_STEP_STATUSES,
  isActiveStepStatus,
  stepStatusSchema,
  UNSTARTED_STEP_STATUSES,
} from '../src/records/step.js';

describe('step status sets', () => {
  test('a step is active until it reaches done, failed or stopped', () => {
    const inactive = stepStatusSchema.options.filter((status) => !isActiveStepStatus(status));
    expect(inactive).toEqual(['done', 'failed', 'stopped']);
  });

  test('an unstarted step is an active step no machine has claimed', () => {
    expect(ACTIVE_STEP_STATUSES.filter((status) => status !== 'claimed')).toEqual([
      ...UNSTARTED_STEP_STATUSES,
    ]);
  });
});
