import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';
import { createdTodoMessage as created } from './fixtures/chief-create-todo.js';

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
  test('a stored MCP create_todo result renders the task card', () => {
    expect(mapChiefStream([created])).toContainEqual({
      kind: 'task-card', todoId: 'todo-1', id: 'm2:task-card',
      projectId: 'proj-1', seq: 9, title: 'Enforce public-content checks',
    });
  });

  test('the card follows the reply that announced it and carries the task project', () => {
    const items = mapChiefStream([
      said('u1', 'user', 'Block internal addresses in hooks and CI'),
      call('m1', 'create_todo', CREATE, { id: 'todo-9' }),
      said('a1', 'assistant', 'Created #126 in cairn and forwarded your words.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'robot', 'task-card']);
    expect(items[2]).toEqual({ kind: 'task-card', todoId: 'todo-9', id: 'm1:task-card', projectId: 'p1', seq: null, title: null });
  });

  test('a turn still streaming its reply already shows the card', () => {
    const items = mapChiefStream([call('m1', 'create_todo', CREATE, JSON.stringify({ id: 'todo-9' }))]);
    expect(items).toContainEqual({ kind: 'task-card', todoId: 'todo-9', id: 'm1:task-card', projectId: 'p1', seq: null, title: null });
  });

  test('a task created during a wake turn still gets its card', () => {
    const items = mapChiefStream([
      said('user-wake', 'user', '[wake:settle] provenance=watch:todo-1\nTask #8 merged.'),
      call('m1', 'create_todo', CREATE, { id: 'todo-9' }),
      said('a1', 'assistant', 'Opened the follow-up.'),
      said('u2', 'user', 'Thanks'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['task-card', 'user']);
    expect(items[0]).toEqual({ kind: 'task-card', todoId: 'todo-9', id: 'm1:task-card', projectId: 'p1', seq: null, title: null });
  });

  test('the card keeps the created task number and title for when the Tasks read no longer lists it', () => {
    const items = mapChiefStream([
      call('m1', 'create_todo', CREATE, JSON.stringify({ id: 'todo-9', seqNum: 126, title: CREATE.title })),
    ]);
    expect(items).toContainEqual({
      kind: 'task-card',
      todoId: 'todo-9',
      id: 'm1:task-card',
      projectId: 'p1',
      seq: 126,
      title: 'Enforce public-content checks',
    });
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
