import { expect, test } from 'vitest';
import { needsYouThreads } from '../src/board/needs-you.js';
import { todo } from './helpers.js';

test('archived tasks do not contribute to the needs-you count', () => {
  const waiting = { ...todo(2, 'review'), archivedAt: 123 };
  expect(needsYouThreads([waiting])).toHaveLength(0);
});
