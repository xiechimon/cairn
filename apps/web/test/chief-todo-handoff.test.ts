import { describe, expect, test } from 'vitest';
import { type MessageRow, mapChiefStream } from '../src/api/mappers.js';

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

describe('a follow-up routed into a running task', () => {
  test('a finished message_todo call becomes a handoff row for that todo', () => {
    const items = mapChiefStream([
      call('m1', 'message_todo', { todoId: 'todo-7', content: '再加个暗色' }, { ok: true }),
    ]);
    expect(items).toContainEqual({ kind: 'handoff', todoId: 'todo-7', id: 'm1:handoff' });
  });

  test('in a live turn the handoff follows its own tool row and keeps a distinct key', () => {
    const items = mapChiefStream(
      [call('m1', 'message_todo', { todoId: 'todo-7', content: 'x' }, { ok: true })],
      true,
    );
    const kinds = items.map((item) => item.kind);
    expect(kinds.indexOf('tool')).toBeLessThan(kinds.indexOf('handoff'));
    const ids = items.map((item) => ('id' in item ? item.id : undefined));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a failed or still-running message_todo call shows no handoff', () => {
    const items = mapChiefStream([
      call('m1', 'message_todo', { todoId: 'todo-7', content: 'x' }, { error: 'gone' }, true),
      call('m2', 'message_todo', { todoId: 'todo-8', content: 'y' }),
    ]);
    expect(items.some((item) => item.kind === 'handoff')).toBe(false);
  });

  test('other tools never produce a handoff', () => {
    const items = mapChiefStream([call('m1', 'create_todo', { title: 't' }, { id: 'todo-9' })]);
    expect(items.some((item) => item.kind === 'handoff')).toBe(false);
  });
});
