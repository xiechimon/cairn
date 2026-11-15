import { describe, expect, test } from 'vitest';
import type { ChiefStreamItem } from '../src/fixtures/records.js';
import { answerLines, awaitingStream } from '../src/chief/question-lifecycle.js';

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

  test('the working row leaves the stream so the question card stands alone', () => {
    const user: ChiefStreamItem = { kind: 'user', text: 'hi' };
    expect(awaitingStream([user, ...stream], true)).toEqual([user]);
  });

  test('with no pending question the stream is returned untouched', () => {
    expect(awaitingStream(stream, false)).toBe(stream);
  });

  test('other rows pass through', () => {
    const user: ChiefStreamItem = { kind: 'user', text: 'hi' };
    expect(awaitingStream([user], true)).toEqual([user]);
  });
});

describe('the answered question becomes the lines of one owner bubble', () => {
  test('a chosen option is the one line', () => {
    expect(answerLines(question())).toEqual(['After CI is green']);
  });

  test('several questions give one line each, free text counts', () => {
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
    expect(answerLines(item)).toEqual(['x、y', 'later']);
  });

  test('missing or empty answers give no lines', () => {
    expect(answerLines(question({ answers: null }))).toEqual([]);
    expect(answerLines(question({ answers: [{ header: 'Merge' }] }))).toEqual([]);
  });

  test('a pending or cancelled question gives no lines, whatever it holds', () => {
    expect(answerLines(question({ status: 'pending' }))).toEqual([]);
    expect(answerLines(question({ status: 'cancelled' }))).toEqual([]);
  });
});
