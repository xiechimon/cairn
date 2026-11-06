import { describe, expect, it } from 'vitest';
import { clampQuestionIndex, coordinatorBadgeCount } from '../src/chief/question-dock-index.js';
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

describe('question dock index', () => {
  it('keeps the shown question in range when one is answered', () => {
    expect(clampQuestionIndex(1, 2)).toBe(1);
    expect(clampQuestionIndex(1, 1)).toBe(0);
    expect(clampQuestionIndex(5, 0)).toBe(0);
    expect(clampQuestionIndex(-1, 3)).toBe(0);
  });

  it('adds pending questions to the Coordinator badge', () => {
    expect(coordinatorBadgeCount(0, 0)).toBe(0);
    expect(coordinatorBadgeCount(2, 0)).toBe(2);
    expect(coordinatorBadgeCount(1, 2)).toBe(3);
  });

  it('counts only pending questions', () => {
    const stream = [question('a', 'pending'), question('b', 'answered'), question('c', 'pending')];
    expect(originChiefQuestions(stream, origin).map((item) => item.item.requestId)).toEqual([
      'a',
      'c',
    ]);
  });
});
