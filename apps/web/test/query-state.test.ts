import { describe, expect, it, vi } from 'vitest';
import { mergeQueries, queryPhase, withTeamsFailure } from '../src/components/query-state.js';

const query = (over: Partial<Parameters<typeof mergeQueries>[0]> = {}) => ({
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...over,
});

describe('queryPhase', () => {
  it('shows loading while pending, even when empty', () => {
    expect(queryPhase(query({ isPending: true }), true)).toBe('loading');
  });

  it('never shows an empty state for a failed query', () => {
    expect(queryPhase(query({ isError: true }), true)).toBe('error');
  });

  it('keeps cached data visible after a refetch error unless errorWins', () => {
    expect(queryPhase(query({ isError: true }), false)).toBe('ready');
    expect(queryPhase(query({ isError: true }), false, true)).toBe('error');
  });

  it('is empty or ready once the query succeeded', () => {
    expect(queryPhase(query(), true)).toBe('empty');
    expect(queryPhase(query(), false)).toBe('ready');
  });

  it('treats a missing query as plain data', () => {
    expect(queryPhase(undefined, true)).toBe('empty');
    expect(queryPhase(undefined, false)).toBe('ready');
  });
});

describe('mergeQueries', () => {
  it('is pending or failed when any part is, and retries only the failed parts', () => {
    const ok = query();
    const bad = query({ isError: true });
    const merged = mergeQueries(ok, bad, query({ isPending: true }));
    expect(merged.isPending).toBe(true);
    expect(merged.isError).toBe(true);
    void merged.refetch();
    expect(bad.refetch).toHaveBeenCalledTimes(1);
    expect(ok.refetch).not.toHaveBeenCalled();
  });
});

describe('withTeamsFailure', () => {
  it('turns a query that is stuck pending behind a failed teams query into an error', () => {
    const teams = { isError: true, isFetching: false, refetch: vi.fn() };
    const result = withTeamsFailure(query({ isPending: true }), teams);
    expect(queryPhase(result, true)).toBe('error');
    void result?.refetch();
    expect(teams.refetch).toHaveBeenCalledTimes(1);
  });

  it('leaves a settled query alone', () => {
    const teams = { isError: true, isFetching: false, refetch: vi.fn() };
    const settled = query();
    expect(withTeamsFailure(settled, teams)).toBe(settled);
  });
});
