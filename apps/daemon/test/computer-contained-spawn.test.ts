import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { containedCommandArgv, python3Executable } from '../src/computer/contained-spawn.js';

test('the launcher is an absolute python3 and the command stays outside the script', () => {
  const allocated = makeTestTempDir('contained-spawn-');
  try {
    const directory = join(allocated, 'bin');
    mkdirSync(directory);
    const python = join(directory, 'python3');
    writeFileSync(python, '');
    chmodSync(python, 0o644);
    expect(python3Executable(directory)).toBeUndefined();
    expect(python3Executable(undefined)).toBeUndefined();
    chmodSync(python, 0o755);
    expect(python3Executable(`/missing:${directory}`)).toBe(python);
    const argv = containedCommandArgv('bash', ['-c', 'pk*ll'], python);
    expect(argv.file).toBe(python);
    expect(argv.args.slice(0, 2)).toEqual(['-S', '-c']);
    expect(argv.args[2]).not.toContain('bash');
    expect(argv.args[2]).not.toContain('pk*ll');
    expect(argv.args.slice(3)).toEqual(['bash', '-c', 'pk*ll']);
    expect(containedCommandArgv('bash', ['-c', 'true'], undefined)).toEqual({
      file: 'bash',
      args: ['-c', 'true'],
    });
  } finally {
    expect(releaseTestTempDir(allocated)).toBe(true);
  }
});
