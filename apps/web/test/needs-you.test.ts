import { describe, expect, test } from 'vitest';
import { needsYouThreads, pendingQuestions } from '../src/board/needs-you.js';
import { todo } from './helpers.js';

const question = (status: 'pending' | 'answered') => ({
  kind: 'question' as const,
  requestId: `q-${status}`,
  status,
  answers: null,
  questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
});

describe('the Needs you set of the home list', () => {
  test('counts confirm, review, failed and awaiting-reply threads, not Coordinator questions', () => {
    const set = [
      todo(1, 'confirm'),
      todo(2, 'review'),
      todo(3, 'failed'),
      todo(4, 'needs_input'),
      todo(5, 'building'),
      todo(6, 'done'),
      todo(7, 'todo'),
    ];
    const stream = [question('pending'), question('answered')];
    expect(needsYouThreads(set)).toHaveLength(4);
    expect(pendingQuestions(stream)).toHaveLength(1);
  });

  test('archived threads leave the set, stale ones stay', () => {
    const old = { ...todo(1, 'failed'), phaseAt: 0 };
    const archived = { ...todo(2, 'review'), archivedAt: 5 };
    expect(needsYouThreads([old, archived]).map((row) => row.seqNum)).toEqual([1]);
  });

  test('orders confirm and awaiting reply first, then failed, then review', () => {
    const order = needsYouThreads([todo(1, 'review'), todo(2, 'failed'), todo(3, 'confirm')]);
    expect(order.map((row) => row.seqNum)).toEqual([3, 2, 1]);
  });
});
