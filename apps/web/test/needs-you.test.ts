import { expect, test } from 'vitest';
import { pendingQuestions } from '../src/board/needs-you.js';

const question = (status: 'pending' | 'answered') => ({
  kind: 'question' as const,
  requestId: `q-${status}`,
  status,
  answers: null,
  questions: [{ header: 'h', question: 'Which first?', options: [{ label: 'A' }] }],
});

test('only pending Coordinator questions are listed', () => {
  expect(pendingQuestions([question('pending'), question('answered')])).toHaveLength(1);
});
