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

  test('a report only hides its identified wake, leaving another wake of the same kind visible', () => {
    const items = mapChiefStream([
      row('report', 'system', JSON.stringify(REPORT)),
      row('user-step', 'user', '[wake:settle] The task is done.'),
      row('user-later', 'user', '[wake:settle] A later task is done.'),
    ]);
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: 'user', text: 'A later task is done.' });
  });

  test('a busy chief reply between a report and its prompt does not reveal the wake instructions', () => {
    const items = mapChiefStream([
      row('report', 'system', JSON.stringify(REPORT)),
      row('reply', 'assistant', 'A separate turn has finished.'),
      row('user-step', 'user', '[wake:settle] The task is done.'),
      row('wake-reply', 'assistant', 'The worker result has been checked.'),
    ]);
    expect(items.map((item) => item.kind)).toEqual(['thread-report', 'robot', 'robot']);
    expect(items[1]).toMatchObject({ markdown: 'A separate turn has finished.' });
    expect(items[2]).toMatchObject({ markdown: 'The worker result has been checked.' });
  });

  test('two queued reports hide exactly their own prompts despite intervening replies', () => {
    const secondReport = { ...REPORT, todoId: 'todo-2', seqNum: 10, wakeStepId: 'second-step' };
    const items = mapChiefStream([
      row('report-1', 'system', JSON.stringify(REPORT)),
      row('report-2', 'system', JSON.stringify(secondReport)),
      row('busy-reply', 'assistant', 'The current turn has finished.'),
      row('user-step', 'user', '[wake:settle] Internal first task instructions'),
      row('first-reply', 'assistant', 'The first task has finished.'),
      row('user-second-step', 'user', '[wake:settle] Internal second task instructions'),
      row('second-reply', 'assistant', 'The second task has finished.'),
      row('user-non-report-step', 'user', '[wake:settle] Check another task'),
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      'thread-report', 'thread-report', 'robot', 'robot', 'robot', 'user',
    ]);
    expect(items.at(-1)).toMatchObject({ kind: 'user', text: 'Check another task' });
  });

  test('legacy reports without a step association still render without hiding a wake', () => {
    const items = mapChiefStream([
      row('legacy-report', 'system', JSON.stringify({ ...REPORT, wakeStepId: undefined })),
      row('user-step', 'user', '[wake:settle] Legacy task completion'),
    ]);
    expect(items[0]).toMatchObject({ kind: 'thread-report', id: 'legacy-report' });
    expect(items[1]).toMatchObject({ kind: 'user', text: 'Legacy task completion' });
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
      row('report', 'system', JSON.stringify({ ...REPORT, wakeStepId: 's2' })),
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
