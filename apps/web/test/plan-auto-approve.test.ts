import { describe, expect, it } from 'vitest';
import { countdownLabel, planAutoState } from '../src/board/plan-auto-approve.js';

describe('countdownLabel', () => {
  it('formats the remaining time as m:ss', () => {
    expect(countdownLabel(600_000)).toBe('10:00');
    expect(countdownLabel(61_000)).toBe('1:01');
    expect(countdownLabel(9_400)).toBe('0:10');
  });

  it('never goes negative', () => {
    expect(countdownLabel(-5_000)).toBe('0:00');
  });
});

describe('planAutoState', () => {
  it('counts down when a deadline is set and the plan is not held', () => {
    expect(planAutoState({ planAutoApproveAt: 1_000 }, 400)).toEqual({ kind: 'counting', remainingMs: 600 });
  });

  it('reports a held plan', () => {
    expect(planAutoState({ planAutoHold: true }, 0)).toEqual({ kind: 'held' });
  });

  it('is off when the server sent neither', () => {
    expect(planAutoState({}, 0)).toEqual({ kind: 'off' });
  });
});
