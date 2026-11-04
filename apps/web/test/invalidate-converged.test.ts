import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateConverged } from '../src/api/invalidate.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mount(qc: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<unknown[]>): void {
  const observer = new QueryObserver<unknown[], Error, unknown[], unknown[], readonly unknown[]>(qc, {
    queryKey,
    queryFn,
  });
  observer.subscribe(() => {});
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('current state: the swallowable paths of query-core raw invalidateQueries (the reason this seam exists)', () => {
  it('invalidation arriving while a mount fetch is in flight is folded into that fetch — after the empty snapshot lands no one fetches again', async () => {
    const qc = makeClient();
    const mountRead = deferred<unknown[]>();
    const queryFn = vi
      .fn<() => Promise<unknown[]>>()
      .mockImplementationOnce(() => mountRead.promise)
      .mockResolvedValue([{ id: 'p0', version: 1 }]);

    mount(qc, ['plans', 'b0'], queryFn);
    const invalidated = qc.invalidateQueries({ queryKey: ['plans'] });
    mountRead.resolve([]);
    await invalidated;
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(['plans', 'b0'])).toEqual([]);
  });
});

describe('invalidation convergence: the hint must not be swallowed by the query layer', () => {
  it('an invalidation arriving while a mount fetch is in flight must trigger one more fetch after the empty snapshot lands (convergence)', async () => {
    const qc = makeClient();
    const mountRead = deferred<unknown[]>();
    const queryFn = vi
      .fn<() => Promise<unknown[]>>()
      .mockImplementationOnce(() => mountRead.promise)
      .mockResolvedValue([{ id: 'p1', version: 1 }]);

    mount(qc, ['plans', 'b1'], queryFn);

    const invalidated = invalidateConverged(qc, { queryKey: ['plans'] });
    mountRead.resolve([]);
    await invalidated;
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(['plans', 'b1'])).toEqual([{ id: 'p1', version: 1 }]);
  });

  it('an invalidation arriving while data is in flight: keep cancel + refetch, landing the post-invalidation snapshot', async () => {
    const qc = makeClient();
    const slow = deferred<unknown[]>();
    const queryFn = vi
      .fn<() => Promise<unknown[]>>()
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue([{ id: 'p2', version: 1 }]);

    mount(qc, ['plans', 'b2'], queryFn);

    qc.setQueryData(['plans', 'b2'], [{ id: 'old' }]);
    await invalidateConverged(qc, { queryKey: ['plans'] });
    slow.resolve([{ id: 'stale' }]);
    await settle();

    expect(qc.getQueryData(['plans', 'b2'])).toEqual([{ id: 'p2', version: 1 }]);
  });

  it('invalidation arriving after a mount fetch failed (error, data still undefined): schedules one more fetch', async () => {
    const qc = makeClient();
    const queryFn = vi
      .fn<() => Promise<unknown[]>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue([{ id: 'p3', version: 1 }]);

    mount(qc, ['plans', 'b3'], queryFn);
    await settle();
    await invalidateConverged(qc, { queryKey: ['plans'] });
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(['plans', 'b3'])).toEqual([{ id: 'p3', version: 1 }]);
  });

  it('no matching query: no error, no request issued', async () => {
    const qc = makeClient();
    const queryFn = vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
    await invalidateConverged(qc, { queryKey: ['plans'] });
    expect(queryFn).not.toHaveBeenCalled();
  });

  it('convergence is bounded: one invalidation appends at most one fetch round, no self-excitation', async () => {
    const qc = makeClient();
    const mountRead = deferred<unknown[]>();
    const queryFn = vi
      .fn<() => Promise<unknown[]>>()
      .mockImplementationOnce(() => mountRead.promise)
      .mockResolvedValue([{ id: 'p4', version: 1 }]);

    mount(qc, ['plans', 'b4'], queryFn);
    const invalidated = invalidateConverged(qc, { queryKey: ['plans'] });
    mountRead.resolve([]);
    await invalidated;
    await settle();
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});