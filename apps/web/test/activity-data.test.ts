import { describe, expect, test, vi } from 'vitest';
import { activityDataState, retryActivityData } from '../src/search/activity-data.js';

const success = () => ({ status: 'success' as const, refetch: vi.fn().mockResolvedValue({}) });
const pending = () => ({ ...success(), status: 'pending' as const });
const error = () => ({ ...success(), status: 'error' as const });

describe('Activity prerequisite and dependency state', () => {
  test('fixtures ignore disabled live queries', () => {
    expect(activityDataState(false, pending(), undefined, [pending()])).toBe('ready');
  });

  test('missing teams load, but failed or empty teams fail instead of waiting forever', () => {
    expect(activityDataState(true, pending(), undefined, [pending()])).toBe('loading');
    expect(activityDataState(true, error(), undefined, [pending()])).toBe('error');
    expect(activityDataState(true, success(), undefined, [pending()])).toBe('error');
  });

  test('every required dependency participates and errors win over pending peers', () => {
    for (const index of [0, 1, 2]) {
      const dependencies = [success(), success(), success()];
      expect(activityDataState(true, success(), 'team', dependencies)).toBe('ready');
      expect(activityDataState(true, success(), 'team', dependencies.map((q, i) => i === index ? pending() : q))).toBe('loading');
      expect(activityDataState(true, success(), 'team', dependencies.map((q, i) => i === index ? error() : pending()))).toBe('error');
    }
  });

  test('cached data does not conceal a failed team or project refresh', () => {
    expect(activityDataState(true, { ...error(), data: [{ id: 'old' }] }, 'old', [success()])).toBe('error');
    expect(activityDataState(true, success(), 'team', [{ ...error(), data: [] }])).toBe('error');
  });

  test('prerequisite retries never invoke disabled queries, including empty teams', async () => {
    for (const teams of [error(), { ...error(), data: [{ id: 'old' }] }, success()]) {
      const dependent = success();
      await retryActivityData(teams, undefined, [dependent]);
      expect(teams.refetch).toHaveBeenCalledOnce();
      expect(dependent.refetch).not.toHaveBeenCalled();
    }
  });

  test('ready-team retry includes all active dependencies without refetching teams', async () => {
    const teams = success();
    const dependencies = [success(), success(), success()];
    await retryActivityData(teams, 'current-team', dependencies);
    expect(teams.refetch).not.toHaveBeenCalled();
    for (const dependency of dependencies) expect(dependency.refetch).toHaveBeenCalledOnce();
  });
});
