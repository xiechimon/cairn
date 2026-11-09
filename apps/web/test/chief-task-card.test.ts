import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';
import { taskCardFacts } from '../src/board/task-card-facts.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const NOW = 1_758_000_000_000;

function call(id: string, name: string, args: unknown, result?: unknown, isError?: boolean): MessageRow {
  return {
    id,
    role: 'assistant',
    content: {
      kind: 'toolcall',
      call: {
        id: `c-${id}`,
        name,
        arguments: args,
        startedAt: NOW,
        endedAt: NOW + 1,
        ...(result !== undefined ? { result } : {}),
        ...(isError !== undefined ? { isError } : {}),
      },
    },
    createdAt: NOW,
  } as MessageRow;
}

function said(id: string, role: 'user' | 'assistant', text: string): MessageRow {
  return { id, role, content: text, createdAt: NOW } as MessageRow;
}

const CREATE = { projectId: 'p1', title: 'Enforce public-content checks', spec: 's' };

describe('a task the Coordinator creates becomes a task card in the conversation', () => {
  test('the card follows the reply that announced it and carries the task project', () => {
    const items = mapChiefStream([
      said('u1', 'user', 'Block internal addresses in hooks and CI'),
      call('m1', 'create_todo', CREATE, { id: 'todo-9' }),
      said('a1', 'assistant', 'Created #126 in cairn and forwarded your words.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'robot', 'task-card']);
    expect(items[2]).toEqual({ kind: 'task-card', todoId: 'todo-9', id: 'm1:task-card', projectId: 'p1' });
  });

  test('a turn still streaming its reply already shows the card', () => {
    const items = mapChiefStream([call('m1', 'create_todo', CREATE, JSON.stringify({ id: 'todo-9' }))]);
    expect(items).toContainEqual({ kind: 'task-card', todoId: 'todo-9', id: 'm1:task-card', projectId: 'p1' });
  });

  test('a failed or unfinished create_todo shows no card', () => {
    const items = mapChiefStream([
      call('m1', 'create_todo', CREATE, { error: 'no project' }, true),
      call('m2', 'create_todo', CREATE),
      said('a1', 'assistant', 'Could not create it.'),
    ]);
    expect(items.some((item) => item.kind === 'task-card')).toBe(false);
  });
});

describe('the task card counts the updates the task posted back', () => {
  const report = (id: string, line?: string): Extract<ChiefStreamItem, { kind: 'thread-report' }> => ({
    kind: 'thread-report',
    id,
    todoId: 'todo-9',
    phase: 'review',
    seqNum: 126,
    title: 'Enforce public-content checks',
    ...(line !== undefined ? { line } : {}),
  });

  test('the reports of that task count; the newest gives the latest line', () => {
    const stream: ChiefStreamItem[] = [
      report('r1', 'Reproduced the leak'),
      { ...report('r2', 'other task'), todoId: 'todo-1' },
      report('r3', 'prepush has the check; CI is next.'),
    ];
    expect(taskCardFacts(stream, 'todo-9')).toEqual({
      updates: 2,
      latest: 'prepush has the check; CI is next.',
    });
  });

  test('a task with no update yet has zero updates and no latest line', () => {
    expect(taskCardFacts([], 'todo-9')).toEqual({ updates: 0, latest: null });
  });

  test('a report without a line keeps the previous latest line', () => {
    expect(taskCardFacts([report('r1', 'first'), report('r2')], 'todo-9')).toEqual({
      updates: 2,
      latest: 'first',
    });
  });

  test('messages sent into the task are not updates from it', () => {
    const sent = (by: 'user' | 'coordinator'): ChiefStreamItem => ({
      kind: 'thread-message',
      id: `tm-${by}`,
      todoId: 'todo-9',
      seqNum: 126,
      title: 't',
      excerpt: 'my note',
      delivered: 'steer',
      conversationId: 'c1',
      by,
    });
    expect(taskCardFacts([sent('user'), sent('coordinator')], 'todo-9')).toEqual({
      updates: 0,
      latest: null,
    });
  });
});
