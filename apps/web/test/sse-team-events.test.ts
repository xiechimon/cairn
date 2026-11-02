import { describe, expect, it } from 'vitest';
import { teamEventInvalidations } from '../src/api/sse-team-events.js';
import { todo } from './helpers.js';

const TEAM = 'team-1';

function keysOf(ev: Record<string, unknown>): string[] {
  return teamEventInvalidations(ev, TEAM).map((k) => k.join('/'));
}

describe('team event → invalidation keys', () => {
  it('todo document event: existing three keys + plans (#666: plan card and phase chip converge on the same event)', () => {
    const doc = todo(7, 'confirm');
    const keys = keysOf({ type: 'todo', seq: 1, v: 3, doc });
    expect(keys).toContain('todos');
    expect(keys).toContain(`todo/${doc.id}`);
    expect(keys).toContain('schedules');
    expect(keys).toContain('plans');
  });

  it('build document event: existing four keys + plans narrowed by buildId', () => {
    const keys = keysOf({
      type: 'build',
      seq: 2,
      v: 1,
      doc: { id: 'build-1', todoId: 'todo-7' },
    });
    expect(keys).toContain('build/build-1');
    expect(keys).toContain('steps/build-1');
    expect(keys).toContain('todos');
    expect(keys).toContain('todo/todo-7');
    expect(keys).toContain('plans/build-1');
  });

  it('notification: three keys verbatim (the desktop-notification side effect is not in the map)', () => {
    const keys = keysOf({
      type: 'notification',
      notification: { id: 'n-1', type: 'plan_ready', entityId: 'todo-7' },
    });
    expect(keys).toEqual([`notifications/${TEAM}`, `chiefThreads/${TEAM}`, 'todos']);
  });

  it('machine_presence carries board todo invalidation (#1257 suspended-state derived); branch_sync single key as usual', () => {

    expect(keysOf({ type: 'machine_presence', machineId: 'm-1', online: true })).toEqual([
      `machines/${TEAM}`,
      'todos',
    ]);
    expect(keysOf({ type: 'branch_sync', sync: { buildId: 'build-1' } })).toEqual([
      'branchSync/build-1',
    ]);
  });

  it('ping and unknown events: zero invalidation', () => {
    expect(keysOf({ type: 'ping', seq: 3 })).toEqual([]);
    expect(keysOf({ type: 'wat' })).toEqual([]);
  });
});
