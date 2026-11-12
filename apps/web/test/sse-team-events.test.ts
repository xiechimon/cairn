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

  it('todo document event refreshes the steps and build of its latest build, so the thread leaves its running state when the conversation stream is down', () => {
    const doc = { ...todo(7, 'confirm'), latestBuildId: 'build-7' };
    const keys = keysOf({ type: 'todo', seq: 1, v: 3, doc });
    expect(keys).toContain('steps/build-7');
    expect(keys).toContain('build/build-7');
    expect(keysOf({ type: 'todo', seq: 2, v: 3, doc: { ...doc, latestBuildId: null } })).not.toContain(
      'steps/null',
    );
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

  it('notification: board, threads, chief context and Tasks keys verbatim (the desktop-notification side effect is not in the map)', () => {
    const keys = keysOf({
      type: 'notification',
      notification: { id: 'n-1', type: 'plan_ready', entityId: 'todo-7' },
    });
    expect(keys).toEqual([
      `notifications/${TEAM}`,
      `chiefThreads/${TEAM}`,
      `chief/${TEAM}`,
      'todos',
      `tasks/${TEAM}`,
    ]);
  });

  it('every event that refreshes the board also refreshes the Tasks panel read', () => {
    const events: Record<string, unknown>[] = [
      { type: 'todo', seq: 1, v: 3, doc: todo(7, 'confirm') },
      { type: 'build', seq: 2, v: 1, doc: { id: 'build-1', todoId: 'todo-7' } },
      { type: 'notification', notification: { id: 'n-2', type: 'chief_message', entityId: 'c-1' } },
      { type: 'machine_presence', machineId: 'm-1', online: false },
    ];
    for (const ev of events) {
      const keys = keysOf(ev);
      expect(keys).toContain('todos');
      expect(keys).toContain(`tasks/${TEAM}`);
    }
  });

  it('machine_presence carries board todo invalidation (#1257 suspended-state derived); branch_sync single key as usual', () => {

    expect(keysOf({ type: 'machine_presence', machineId: 'm-1', online: true })).toEqual([
      `machines/${TEAM}`,
      `computers/${TEAM}`,
      'todos',
      `tasks/${TEAM}`,
      `model-routing/${TEAM}`,
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
