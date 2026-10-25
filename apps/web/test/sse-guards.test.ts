import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { hasInFlightWork, streamGuards } from '../src/api/sse-guards.js';
import { todo } from './helpers.js';

const TEAM = 'team-1';

function clientWith(seed: (qc: QueryClient) => void): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed(qc);
  return qc;
}

describe('gate: the cache still has work in flight', () => {
  it('board list query has planning → open', () => {
    const qc = clientWith((c) =>
      c.setQueryData(['todos', TEAM], [todo(1, 'todo'), todo(2, 'planning')]),
    );
    expect(hasInFlightWork(qc)).toBe(true);
  });

  it('detail single query (todo/id object shape, not array) has building → open', () => {
    const qc = clientWith((c) => c.setQueryData(['todo', 'todo-9'], todo(9, 'building')));
    expect(hasInFlightWork(qc)).toBe(true);
  });

  it('all phases waiting-for-user or terminal → closed (silence is the norm, not a fault)', () => {
    const qc = clientWith((c) =>
      c.setQueryData(
        ['todos', TEAM],
        [todo(1, 'todo'), todo(2, 'confirm'), todo(3, 'review'), todo(4, 'done'), todo(5, 'failed')],
      ),
    );
    expect(hasInFlightWork(qc)).toBe(false);
  });

  it('no todo query in the cache at all → closed (page not mounted = behavior before this mechanism)', () => {
    const qc = clientWith((c) => c.setQueryData(['machines', TEAM], [{ id: 'm1' }]));
    expect(hasInFlightWork(qc)).toBe(false);
  });

  it('data not landed yet (undefined / empty array) → closed', () => {
    const qc = clientWith((c) => c.setQueryData(['todos', TEAM], []));
    expect(hasInFlightWork(qc)).toBe(false);
  });
});

describe('reconcile action: invalidation face', () => {
  it('invalidates the union of SSE-related keys, does not touch keys that are not SSE-driven but constantly active', () => {
    const qc = clientWith((c) => c.setQueryData(['todos', TEAM], [todo(1, 'planning')]));
    const spy = vi.spyOn(qc, 'invalidateQueries');

    streamGuards(qc).reconcile();

    const keys = spy.mock.calls.map(([filters]) => (filters?.queryKey as string[])[0]);

    for (const head of [
      'todos',
      'todo',
      'schedules',
      'build',
      'steps',
      'notifications',
      'chiefThreads',
      'machines',
      'branchSync',
      'messages',
      'plans',
      'changes',
    ]) {
      expect(keys).toContain(head);
    }

    expect(keys).not.toContain('session');
    expect(keys).not.toContain('teams');
    expect(keys).not.toContain('providers');
  });

  it('the gate is the inFlight of the reconcile face', () => {
    const qc = clientWith((c) => c.setQueryData(['todos', TEAM], [todo(1, 'building')]));
    const guards = streamGuards(qc);
    expect(guards.inFlight()).toBe(true);

    qc.setQueryData(['todos', TEAM], [todo(1, 'confirm')]);
    expect(guards.inFlight()).toBe(false);
  });
});