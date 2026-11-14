import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { replyDeliveryOf } from '../src/board/reply-delivery.js';

const MARKER = {
  kind: 'thread-message',
  todoId: 'todo-7',
  seqNum: 7,
  title: 'Split the routing migration',
  excerpt: 'Split the migration out first',
  delivered: 'revision',
  conversationId: 'build-1',
};

function row(id: string, content: unknown, projectId?: string): MessageRow {
  return { id, role: 'system', content, createdAt: 100, ...(projectId ? { projectId } : {}) };
}

describe('direct thread messages in the Coordinator conversation', () => {
  test('a thread-message row becomes a marker filed under its project', () => {
    expect(mapChiefStream([row('m-1', JSON.stringify(MARKER), 'project-1')])).toEqual([
      { ...MARKER, id: 'm-1', projectId: 'project-1' },
    ]);
  });

  test('the mapper keeps the sender on a coordinator-origin marker', () => {
    expect(
      mapChiefStream([
        row('m-coord', JSON.stringify({ ...MARKER, by: 'coordinator' }), 'project-1'),
      ]),
    ).toEqual([{ ...MARKER, by: 'coordinator', id: 'm-coord', projectId: 'project-1' }]);
  });

  test('malformed rows stay hidden', () => {
    expect(
      mapChiefStream([
        row('bad-delivery', JSON.stringify({ ...MARKER, delivered: 'approve' })),
        row('no-todo', JSON.stringify({ kind: 'thread-message', seqNum: 7 })),
        row('bad-json', '{"kind":"thread-message"'),
      ]),
    ).toEqual([]);
  });
});

describe('how a home card reply reaches its thread', () => {
  test.each([
    ['confirm', 'revision'],
    ['review', 'revision'],
    ['failed', 'restart'],
    ['building', 'steer'],
    ['needs_input', 'steer'],
    ['done', 'steer'],
    ['queued', null],
    ['todo', null],
    ['closed', null],
  ] as const)('%s → %s', (phase, delivery) => {
    expect(replyDeliveryOf(phase)).toBe(delivery);
  });
});
