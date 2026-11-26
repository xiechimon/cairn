import { describe, expect, test } from 'vitest';
import type { ChiefStreamItem } from '../src/fixtures/records.js';
import { answerLineOf, awaitingStream } from '../src/chief/question-lifecycle.js';

describe('a pending question stops the conversation saying it is working, until the owner speaks', () => {
  const working: ChiefStreamItem = { kind: 'streaming', label: '处理中...', startedAt: 5, signalAt: 6 };
  const asked = {
    kind: 'question',
    id: 'ask-1',
    requestId: 'ask-1',
    status: 'pending',
    questions: [{ header: 'H', question: 'Q?', options: [{ label: 'A' }] }],
    answers: null,
  } as ChiefStreamItem;
  const user: ChiefStreamItem = { kind: 'user', text: 'hi' };

  test('the working row leaves the stream while the question waits', () => {
    expect(awaitingStream([user, asked, working])).toEqual([user, asked]);
  });

  test('a message sent after the question brings the working row back', () => {
    const stream = [asked, user, working];
    expect(awaitingStream(stream)).toBe(stream);
  });

  test('with no pending question the stream is returned untouched', () => {
    const stream = [user, working];
    expect(awaitingStream(stream)).toBe(stream);
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
