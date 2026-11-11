import { describe, expect, test } from 'vitest';
import type { ChiefStreamItem } from '../src/fixtures/records.js';
import { answerSummary, awaitingStream } from '../src/chief/question-lifecycle.js';

type Question = Extract<ChiefStreamItem, { kind: 'question' }>;

const question = (over: Partial<Question> = {}): Question => ({
  kind: 'question',
  id: 'row-1',
  requestId: 'q1',
  status: 'answered',
  questions: [
    {
      header: 'Merge',
      question: 'When to merge?',
      options: [{ label: 'After CI is green' }, { label: 'Now' }],
    },
  ],
  answers: [{ header: 'Merge', choices: ['After CI is green'] }],
  ...over,
});

describe('a pending question stops the conversation saying it is working', () => {
  const stream: ChiefStreamItem[] = [
    { kind: 'streaming', label: '处理中...', startedAt: 5, signalAt: 6 },
  ];

  test('the streaming row becomes a waiting row without a clock or signal', () => {
    const [row] = awaitingStream(stream, true);
    expect(row).toMatchObject({ kind: 'streaming', label: '在等你回答', waiting: true });
    expect(row).not.toHaveProperty('startedAt');
    expect(row).not.toHaveProperty('signalAt');
  });

  test('with no pending question the stream is returned untouched', () => {
    expect(awaitingStream(stream, false)).toBe(stream);
  });

  test('other rows pass through', () => {
    const user: ChiefStreamItem = { kind: 'user', text: 'hi' };
    expect(awaitingStream([user], true)).toEqual([user]);
  });
});

describe('the answered question becomes one line', () => {
  test('a chosen option reads as the summary', () => {
    expect(answerSummary(question())).toBe('After CI is green');
  });

  test('several questions join with a separator, free text counts', () => {
    const item = question({
      questions: [
        { header: 'A', question: 'a?', options: [{ label: 'x' }] },
        { header: 'B', question: 'b?', options: [] },
      ],
      answers: [
        { header: 'A', choices: ['x', 'y'] },
        { header: 'B', text: 'later' },
      ],
    });
    expect(answerSummary(item)).toBe('x、y；later');
  });

  test('missing or empty answers summarize to an empty string', () => {
    expect(answerSummary(question({ answers: null }))).toBe('');
    expect(answerSummary(question({ answers: [{ header: 'Merge' }] }))).toBe('');
  });
});
