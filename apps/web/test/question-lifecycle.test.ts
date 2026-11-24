import { describe, expect, test } from 'vitest';
import type { ChiefStreamItem } from '../src/fixtures/records.js';
import { answerLineOf, awaitingStream } from '../src/chief/question-lifecycle.js';

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

describe('the receipt reads one answer per question', () => {
  test('choices join with the list mark, free text counts, nothing gives an empty line', () => {
    expect(answerLineOf({ header: 'A', choices: ['x', 'y'] })).toBe('x、y');
    expect(answerLineOf({ header: 'B', text: ' later ' })).toBe('later');
    expect(answerLineOf({ header: 'C' })).toBe('');
    expect(answerLineOf(undefined)).toBe('');
  });
});
