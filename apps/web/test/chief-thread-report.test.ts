import { describe, expect, test } from 'vitest';
import { mapChiefStream, type MessageRow } from '../src/api/mappers.js';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';

const REPORT = {
  kind: 'thread-report',
  todoId: 'todo-1',
  phase: 'done',
  seqNum: 9,
  title: 'Repair board counts',
};

function row(id: string, role: MessageRow['role'], content: unknown): MessageRow {
  return { id, role, content, createdAt: 100 };
}

describe('chief thread reports', () => {
  test.each(['done', 'failed', 'review'])(
    '%s reports precede the assistant summary and keep their message identity',
    (phase) => {
      const items = mapChiefStream([
        row('report-1', 'system', JSON.stringify({ ...REPORT, phase })),
        row(
          'user-step',
          'user',
          `[wake:${phase === 'done' ? 'settle' : phase === 'failed' ? 'failed' : 'gate'}] Internal task reporting instructions`,
        ),
        row('reply', 'assistant', 'The worker result has been checked.'),
      ]);
      expect(items).toEqual([
        { ...REPORT, phase, id: 'report-1' },
        {
          kind: 'robot',
          id: 'reply',
          markdown: 'The worker result has been checked.',
          seconds: '',
        },
      ]);
    },
  );

  test('malformed reports are ignored', () => {
    expect(
      mapChiefStream([
        row('invalid-phase', 'system', JSON.stringify({ ...REPORT, phase: 'building' })),
        row('missing-task', 'system', JSON.stringify({ kind: 'thread-report', phase: 'done' })),
        row('invalid-json', 'system', '{"kind":"thread-report"'),
      ]),
    ).toEqual([]);
  });

  test('report labels use a Chinese source and an English translation', () => {
    const key = '来自任务 #{n} {title} 的消息';
    const vars = { n: 9, title: 'Repair board counts' };
    expect(translate('zh', EN, key, vars)).toBe('来自任务 #9 Repair board counts 的消息');
    expect(translate('en', EN, key, vars)).toBe('Message from task #9 Repair board counts');
  });

  test('a report does not hide a scheduled reminder immediately after it', () => {
    const items = mapChiefStream([
      row('report', 'system', JSON.stringify(REPORT)),
      row('user-reminder', 'user', '[wake:wake] Check task progress'),
    ]);
    expect(items[1]).toMatchObject({ kind: 'user', text: 'Check task progress' });
  });

  test('a report only hides the immediately following matching wake', () => {
    const items = mapChiefStream([
      row('report', 'system', JSON.stringify(REPORT)),
      row('user-done', 'user', '[wake:settle] The task is done.'),
      row('user-later', 'user', '[wake:settle] A later task is done.'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'user', text: 'A later task is done.' });
  });

  test('intervening messages break the pairing between a report and a wake', () => {
    const items = mapChiefStream([
      row('report', 'system', JSON.stringify(REPORT)),
      row('reply', 'assistant', 'A separate turn has finished.'),
      row('user-later', 'user', '[wake:settle] A later task is done.'),
    ]);
    expect(items[2]).toMatchObject({ kind: 'user', text: 'A later task is done.' });
  });

  test('a report does not hide a wake from a different phase', () => {
    const items = mapChiefStream([
      row('report', 'system', JSON.stringify(REPORT)),
      row('user-gate', 'user', '[wake:gate] Review the plan.'),
    ]);
    expect(items[1]).toMatchObject({ kind: 'user', text: 'Review the plan.' });
  });

  test('a report arriving mid-turn preserves that turn’s tool pills', () => {
    const items = mapChiefStream([
      row('tool', 'assistant', {
        kind: 'toolcall',
        call: { id: 'call-1', name: 'todos', arguments: {}, result: [] },
      }),
      row('report', 'system', JSON.stringify(REPORT)),
      row('reply', 'assistant', 'The worker result has been checked.'),
    ]);
    expect(items[1]).toMatchObject({ kind: 'robot', tools: [{ label: 'todos' }] });
  });

  test('a hidden wake starts a new turn without reusing the previous fallback model', () => {
    const items = mapChiefStream([
      row(
        'fallback',
        'system',
        JSON.stringify({ kind: 'chief_model_fallback', from: 'primary', to: 'backup', stepId: 's1' }),
      ),
      row('user-s1', 'user', 'Check task progress'),
      row('reply-s1', 'assistant', 'The task is running.'),
      row('report', 'system', JSON.stringify(REPORT)),
      row('user-s2', 'user', '[wake:settle] The task is done.'),
      row('reply-s2', 'assistant', 'The result has been confirmed.'),
    ]);
    expect(items[1]).toMatchObject({ kind: 'robot', fallbackModel: 'backup' });
    expect(items[3]).toEqual({
      kind: 'robot',
      id: 'reply-s2',
      markdown: 'The result has been confirmed.',
      seconds: '',
    });
  });
});
