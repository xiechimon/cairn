import { describe, expect, test } from 'vitest';
import { threadProgress } from '../src/board/thread-panel-model.js';

describe('threadProgress', () => {
  test.each([
    ['queued', false, 0, 'run'],
    ['confirm', false, 0, 'wait'],
    ['building', false, 1, 'run'],
    ['building', true, 2, 'run'],
    ['needs_input', false, 1, 'wait'],
    ['review', false, 3, 'wait'],
    ['done', false, 4, 'idle'],
  ] as const)('a code task in %s (checks pending %s) is at step %i, %s', (phase, checks, at, tone) => {
    expect(threadProgress({ phase, output: 'code' }, checks)).toMatchObject({ at, tone });
  });

  test('a research task has two steps and waits on you once its report is in review', () => {
    expect(threadProgress({ phase: 'review', output: 'info' }, false)).toEqual({
      steps: ['调研', '交报告'],
      at: 1,
      tone: 'wait',
    });
  });

  test('failed and closed tasks show no progress', () => {
    expect(threadProgress({ phase: 'failed', output: 'code' }, false)).toBeNull();
    expect(threadProgress({ phase: 'closed', output: 'code' }, true)).toBeNull();
  });
});
