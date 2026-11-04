import { expect, test } from 'vitest';
import { needsYouCount } from '../src/board/needs-you.js';
import { todo } from './helpers.js';

test('archived tasks do not contribute to the needs-you count', () => {
  const waiting = { ...todo(2, 'review'), archivedAt: 123 };
  expect(needsYouCount([waiting], [])).toBe(0);
});
