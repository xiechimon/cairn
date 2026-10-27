import { expect, test } from 'vitest';
import * as shared from '../src/index.js';
import * as gate from '../src/records/merge-gate.js';
import * as legacy from '../src/records/plan.js';

test('the existing plan API re-exports the protected parser bindings', () => {
  expect(legacy.checkPlanContract).toBe(gate.checkPlanContract);
  expect(legacy.planVerificationItems).toBe(gate.planVerificationItems);
  expect(shared.checkPlanContract).toBe(gate.checkPlanContract);
  expect(shared.planVerificationItems).toBe(gate.planVerificationItems);
  expect(legacy.PLAN_SECTIONS).toBe(gate.PLAN_SECTIONS);
  expect(Object.isFrozen(gate.PLAN_SECTIONS)).toBe(true);
});
