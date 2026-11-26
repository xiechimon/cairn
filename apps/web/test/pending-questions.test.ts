import { describe, expect, it } from 'vitest';
import { originChiefQuestions } from '../src/chief/question-origin.js';
import type { ChiefStreamItem } from '../src/fixtures/records.js';

const origin = { teamId: 't1', conversationId: 'c1', title: 'Chat' };

function question(requestId: string, status: 'pending' | 'answered' | 'cancelled'): ChiefStreamItem {
  return {
    id: `row-${requestId}`,
    kind: 'question',
    requestId,
    status,
    questions: [{ header: 'H', question: 'Q?', options: [{ label: 'A' }] }],
    answers: null,
  } as ChiefStreamItem;
}

describe('pending questions', () => {
  it('counts only pending questions', () => {
    const stream = [question('a', 'pending'), question('b', 'answered'), question('c', 'pending')];
    expect(originChiefQuestions(stream, origin).map((item) => item.item.requestId)).toEqual([
      'a',
      'c',
    ]);
  });
});
