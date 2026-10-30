import { expect, test } from 'vitest';
import {
  attentionCount,
  canDropOnColumn,
  countInColumn,
  openCountByProject,
} from '../src/board/columns.js';
import { todo } from './helpers.js';

test('archived tasks do not contribute to active sidebar counts or accept board drops', () => {
  const running = { ...todo(1, 'building'), archivedAt: 123 };
  const waiting = { ...todo(2, 'review'), archivedAt: 123 };
  expect(countInColumn([running], 'building')).toBe(0);
  expect(attentionCount([waiting], 123)).toBe(0);
  expect(openCountByProject([running, waiting]).size).toBe(0);
  expect(canDropOnColumn(running, 'done')).toBe(false);
});
