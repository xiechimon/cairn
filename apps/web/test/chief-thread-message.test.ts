import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { replyDeliveryOf } from '../src/board/needs-you-thread-card.js';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';

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

  test('malformed rows stay hidden', () => {
    expect(
      mapChiefStream([
        row('bad-delivery', JSON.stringify({ ...MARKER, delivered: 'approve' })),
        row('no-todo', JSON.stringify({ kind: 'thread-message', seqNum: 7 })),
        row('bad-json', '{"kind":"thread-message"'),
      ]),
    ).toEqual([]);
  });

  test('the marker label has a Chinese source and an English translation', () => {
    const key = '你直接对 #{n} 说：{excerpt}';
    const vars = { n: 7, excerpt: 'Split it' };
    expect(translate('zh', EN, key, vars)).toBe('你直接对 #7 说：Split it');
    expect(translate('en', EN, key, vars)).toBe('You told #7 directly: Split it');
  });
});

describe('how a home card reply reaches its thread', () => {
  test.each([
    ['confirm', 'revision'],
    ['review', 'revision'],
    ['failed', 'restart'],
    ['building', 'steer'],
    ['done', 'steer'],
    ['queued', null],
    ['todo', null],
    ['closed', null],
  ] as const)('%s → %s', (phase, delivery) => {
    expect(replyDeliveryOf(phase)).toBe(delivery);
  });
});
