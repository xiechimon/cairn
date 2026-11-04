import { afterEach, describe, expect, test } from 'vitest';
import { runGit } from '../src/lib/git.js';

const BIG_STDIN = new Uint8Array(1024 * 1024).fill(0x61);

describe('runGit stdin write-side fallback (#216)', () => {
  const leaked: Error[] = [];
  const onUncaught = (e: Error) => {
    if ((e as NodeJS.ErrnoException).code === 'EPIPE') leaked.push(e);
  };

  afterEach(() => {
    process.removeListener('uncaughtException', onUncaught);
  });

  test('subprocess exits without reading stdin -> in-flight write EPIPE must not leak as an unhandled error, Promise settles normally', async () => {
    process.on('uncaughtException', onUncaught);
    try {
      const r = await runGit(['--version'], { stdin: BIG_STDIN });
      expect(r.code).toBe(0);
      expect(r.stdout.toString('utf8')).toContain('git version');
      await new Promise((resolve) => setImmediate(resolve));
      expect(leaked).toEqual([]);
    } finally {
      process.removeListener('uncaughtException', onUncaught);
    }
  });
});
