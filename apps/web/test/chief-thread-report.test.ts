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
  wakeStepId: 'step',
};

function row(id: string, role: MessageRow['role'], content: unknown): MessageRow {
  return { id, role, content, createdAt: 100 };
}

describe('chief thread reports and quiet event turns (#1784)', () => {
  test.each(['done', 'failed', 'review', 'needs-you'])(
    '%s report stays while the wake prompt, its tools and its text are hidden',
    (phase) => {
      const items = mapChiefStream(
        [
          row('report-1', 'system', JSON.stringify({ ...REPORT, phase })),
          row(
            'user-step',
            'user',
            `[wake:${phase === 'done' ? 'settle' : phase === 'failed' ? 'failed' : 'gate'}] provenance=watch:todo-1\nInternal task reporting instructions`,
          ),
          row('tool', 'assistant', {
            kind: 'toolcall',
            call: { id: 'call-1', name: 'machines', arguments: {}, result: [] },
          }),
          row('thinking', 'assistant', [{ type: 'thinking', thinking: 'checking' }]),
          row('reply', 'assistant', 'The worker result has been checked.'),
        ],
      );
      expect(items).toEqual([{ ...REPORT, phase, id: 'report-1' }]);
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
    const key = '{n}：{status}';
    const vars = { n: 'Repair board counts', status: translate('en', EN, '已完成') };
    expect(translate('zh', EN, key, { ...vars, status: '已完成' })).toBe(
      'Repair board counts：已完成',
    );
    expect(translate('en', EN, key, vars)).toBe('Repair board counts: Done');
  });

  test('an invisible resumed-turn boundary restores the reply without rendering generated prompt text', () => {
    const items = mapChiefStream([
      row('owner', 'user', 'Fix the keyboard'),
      row('user-failed-wake', 'user', '[wake:failed] provenance=watch:other\nCheck a failure'),
      row('wake-reply', 'assistant', 'Checking the failure.'),
      row('user-resumed', 'system', ''),
      row('resumed-reply', 'assistant', 'Started task 169.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'robot']);
    expect(items[1]).toMatchObject({ markdown: 'Started task 169.' });
  });

  test('a resumed boundary seals the previous wake task card before the owner reply', () => {
    const items = mapChiefStream([
      row('user-wake', 'user', '[wake:failed] provenance=watch:other'),
      row('created', 'assistant', {
        kind: 'toolcall', call: { id: 'create', name: 'create_todo', arguments: {}, result: { id: 'todo-1' } },
      }),
      row('user-resumed', 'system', ''),
      row('reply', 'assistant', 'Continuing your answer.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['task-card', 'robot']);
  });

  test('a timed wake is silent and the next user turn is visible again', () => {
    const items = mapChiefStream([
      row('user-reminder', 'user', '[wake:wake] provenance=wake:w1\nCheck task progress'),
      row('wake-reply', 'assistant', 'Nothing new.'),
      row('user-next', 'user', 'How is it going?'),
      row('reply', 'assistant', 'Still running.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'robot']);
    expect(items[1]).toMatchObject({ markdown: 'Still running.' });
  });

  test('a notify_user notice and a pending question from an event turn reach the conversation', () => {
    const items = mapChiefStream([
      row('user-step', 'user', '[wake:failed] provenance=watch:todo-1\nThe task failed.'),
      row(
        'notice',
        'system',
        JSON.stringify({
          kind: 'chief_notice',
          message: '#9 needs another machine.',
          provenance: 'watch:todo-1',
        }),
      ),
      row(
        'ask-1',
        'assistant',
        JSON.stringify({
          kind: 'ask_user_question',
          requestId: 'ask-1',
          status: 'pending',
          questions: [{ header: 'Next', question: 'Retry?', options: [{ label: 'Retry' }] }],
          answers: null,
          provenance: 'watch:todo-1',
        }),
      ),
      row('reply', 'assistant', 'Asked the user.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['robot', 'question']);
    expect(items[0]).toMatchObject({ markdown: '#9 needs another machine.' });
  });

  test('a user turn reply before a wake keeps its text and tool pills', () => {
    const items = mapChiefStream([
      row('user-1', 'user', 'Check the board'),
      row('tool', 'assistant', {
        kind: 'toolcall',
        call: { id: 'call-1', name: 'todos', arguments: {}, result: [] },
      }),
      row('report', 'system', JSON.stringify(REPORT)),
      row('reply', 'assistant', 'The board is fine.'),
      row('user-step', 'user', '[wake:settle] provenance=watch:todo-1\nThe task is done.'),
      row('wake-reply', 'assistant', 'The result has been confirmed.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'thread-report', 'robot']);
    expect(items[2]).toMatchObject({ markdown: 'The board is fine.', tools: [{ label: 'todos' }] });
  });

  test('a message sent during a wake turn shows, and everything the turn says after it shows too', () => {
    const items = mapChiefStream([
      row('user-wake', 'user', '[wake:failed] provenance=watch:todo-1\nThe task failed.'),
      row('posted-1', 'user', 'Also check the relay'),
      row('wake-text', 'assistant', 'Checking machines.'),
      row('user-posted-1', 'user', 'Also check the relay'),
      row('reply', 'assistant', 'The relay is up.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['user', 'robot', 'robot']);
    expect(items[2]).toMatchObject({ markdown: 'The relay is up.' });
  });
});
