import { PHASE_VALUES } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { canMarkDone } from '../src/board/use-mark-done.js';
import { probeTodo } from '../src/fixtures/core.js';

const OPEN = ['todo', 'queued', 'planning', 'confirm', 'building', 'needs_input', 'review'];

describe('canMarkDone', () => {
  for (const phase of PHASE_VALUES) {
    const expected = OPEN.includes(phase);
    it(`${phase} is ${expected ? 'finishable' : 'not finishable'}`, () => {
      expect(canMarkDone({ ...probeTodo(phase, 0) })).toBe(expected);
    });
  }

  it('refuses an archived task in a finishable phase', () => {
    expect(canMarkDone({ ...probeTodo('review', 0), archivedAt: 1 })).toBe(false);
  });
});
