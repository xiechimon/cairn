import { describe, expect, it } from 'vitest';
import { boundedChangesDiff, stepProbeHeads } from '../src/step-pr-probe.js';

describe('stepProbeHeads', () => {
  it('puts the work branch first, then the drift branch, then artifact branches up to three', () => {
    expect(stepProbeHeads('work', 'drift', ['work', 'a', 'b'])).toEqual(['work', 'drift', 'a']);
    expect(stepProbeHeads('work', null, ['a', 'a', 'b', 'c'])).toEqual(['work', 'a', 'b']);
  });
});

describe('boundedChangesDiff', () => {
  it('returns null and logs when the diff fails', async () => {
    const logs: string[] = [];
    const diff = await boundedChangesDiff(
      async () => {
        throw new Error('no base');
      },
      '/tmp',
      'main',
      (m) => logs.push(m),
    );
    expect(diff).toBeNull();
    expect(logs).toEqual(['changes diff failed: no base']);
  });

  it('returns a small diff unchanged', async () => {
    expect(
      await boundedChangesDiff(
        async () => 'diff',
        '/tmp',
        'main',
        () => {},
      ),
    ).toBe('diff');
  });
});
