import { describe, expect, test } from 'vitest';
import {
  inProgressThreads,
  needsYouCount,
  needsYouThreads,
  pendingQuestions,
} from '../src/board/needs-you.js';
import { todo } from './helpers.js';

const question = (status: 'pending' | 'answered') => ({
  kind: 'question' as const,
  requestId: `q-${status}`,
  status,
  answers: null,
  questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
});

describe('the Needs you set, shared by the home list and the sidebar badge', () => {
  test('counts confirm, code review and questions the Coordinator escalated; failures, research reports and unescalated questions go to the Coordinator (task stall S11)', () => {
    const set = [
      todo(1, 'confirm'),
      todo(2, 'review'),
      todo(3, 'failed'),
      { ...todo(4, 'needs_input'), waitingOn: { on: 'owner' as const, retryAt: null } },
      { ...todo(8, 'needs_input'), waitingOn: { on: 'coordinator' as const, retryAt: null } },
      { ...todo(9, 'review'), output: 'info' as const },
      todo(5, 'building'),
      todo(6, 'done'),
      todo(7, 'todo'),
    ];
    const stream = [question('pending'), question('answered')];
    expect(needsYouThreads(set).map((row) => row.seqNum).sort()).toEqual([1, 2, 4]);
    expect(needsYouCount(set)).toBe(3);
    expect(pendingQuestions(stream)).toHaveLength(1);
  });

  test('a failed thread whose question was escalated waits on the owner, not the Coordinator', () => {
    const escalated = { ...todo(3, 'failed'), waitingOn: { on: 'owner' as const, retryAt: null } };
    expect(needsYouThreads([escalated]).map((row) => row.seqNum)).toEqual([3]);
    expect(inProgressThreads([escalated])).toEqual([]);
  });

  test('a thread the Coordinator now owns stays visible as in progress instead of dropping out of every group', () => {
    const set = [
      todo(1, 'confirm'),
      todo(3, 'failed'),
      { ...todo(8, 'needs_input'), waitingOn: { on: 'coordinator' as const, retryAt: null } },
      { ...todo(9, 'review'), output: 'info' as const },
      todo(5, 'building'),
      todo(6, 'done'),
      { ...todo(10, 'failed'), archivedAt: 1 },
    ];
    expect(
      inProgressThreads(set)
        .map((row) => row.seqNum)
        .sort((a, b) => a - b),
    ).toEqual([3, 5, 8, 9]);
  });

  test('archived threads leave the set, stale ones stay', () => {
    const old = { ...todo(1, 'confirm'), phaseAt: 0 };
    const archived = { ...todo(2, 'review'), archivedAt: 5 };
    expect(needsYouThreads([old, archived]).map((row) => row.seqNum)).toEqual([1]);
  });

  test('orders confirm and escalated questions first, then review', () => {
    const order = needsYouThreads([todo(1, 'review'), todo(2, 'failed'), todo(3, 'confirm')]);
    expect(order.map((row) => row.seqNum)).toEqual([3, 1]);
  });
});
