import { describe, expect, it } from 'vitest';
import { AnonReadBudget } from '../src/services/ci-anon-budget.js';

describe('AnonReadBudget', () => {
  it('stops at the own limit and refills after an hour', () => {
    const budget = new AnonReadBudget(2, 10);
    expect(budget.take(0)).toBe(true);
    expect(budget.take(1)).toBe(true);
    expect(budget.take(2)).toBe(false);
    expect(budget.take(3_600_000)).toBe(true);
  });

  it('counts shared reads against the address limit only', () => {
    const budget = new AnonReadBudget(5, 3);
    budget.recordShared(0, 2);
    expect(budget.free(0)).toBe(1);
    expect(budget.take(0, 2)).toBe(false);
    expect(budget.take(0)).toBe(true);
    expect(budget.free(0)).toBe(0);
  });
});
