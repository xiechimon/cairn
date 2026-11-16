import { describe, expect, test } from 'vitest';
import { threadProgress } from '../src/board/thread-panel-model.js';

describe('threadProgress', () => {
  test.each([
    'queued', 'confirm', 'building', 'needs_input', 'review', 'done',
  ] as const)('a code task in %s does not imply mandatory review or merging', (phase) => {
    expect(threadProgress({ phase, output: 'code' }, false)).toBeNull();
    expect(threadProgress({ phase, output: 'code' }, true)).toBeNull();
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
