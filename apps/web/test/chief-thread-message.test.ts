import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { threadTargetsOf } from '../src/board/composer-thread-target.js';
import { replyDeliveryOf } from '../src/board/reply-delivery.js';
import type { TodoRecord } from '../src/fixtures/records.js';
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

  test('the marker label has a Chinese source and an English translation', () => {
    const key = '你直接对 {n} 说：{excerpt}';
    const vars = { n: 'Export', excerpt: 'Split it' };
    expect(translate('zh', EN, key, vars)).toBe('你直接对 Export 说：Split it');
    expect(translate('en', EN, key, vars)).toBe('You told Export directly: Split it');
  });

  test('a coordinator-origin marker uses the Coordinator label, not the user label', () => {
    const key = 'Coordinator 直接对 {n} 说：{excerpt}';
    const vars = { n: 'Export', excerpt: 'Split it' };
    expect(translate('zh', EN, key, vars)).toBe('Coordinator 直接对 Export 说：Split it');
    expect(translate('en', EN, key, vars)).toBe('The Coordinator told Export directly: Split it');
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

describe('which threads the home composer can talk to', () => {
  const at = (id: string, phase: TodoRecord['phase'], extra: Partial<TodoRecord> = {}) =>
    ({ id, phase, phaseAt: Number(id.slice(1)), latestBuildId: `b-${id}`, archivedAt: null, ...extra }) as TodoRecord;

  test('only started, unarchived threads that a message can reach, newest first', () => {
    const targets = threadTargetsOf([
      at('t1', 'building'),
      at('t2', 'queued'),
      at('t3', 'confirm'),
      at('t4', 'building', { latestBuildId: null }),
      at('t5', 'failed', { archivedAt: 9 }),
      at('t6', 'failed'),
    ]);
    expect(targets.map((target) => [target.todo.id, target.delivery])).toEqual([
      ['t6', 'restart'],
      ['t3', 'revision'],
      ['t1', 'steer'],
    ]);
  });
});
