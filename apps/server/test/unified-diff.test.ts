import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { runGit } from '../src/lib/git.js';
import { parseUnifiedDiff } from '../src/services/git.js';

describe('unified diff library adapter', () => {
  it('reads actual Git output with a Unicode filename and header-like contents', async () => {
    const cwd = makeTestTempDir('cairn-diff-parser-');
    try {
      expect((await runGit(['init', '--quiet'], { cwd })).code).toBe(0);
      const path = 'caf\u00e9.txt';
      writeFileSync(join(cwd, path), '-- old heading\n');
      expect((await runGit(['add', '--', path], { cwd })).code).toBe(0);
      writeFileSync(join(cwd, path), '++ new heading\n');
      const result = await runGit(['-c', 'core.quotePath=true', 'diff', '--', path], {
        cwd,
        env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      });
      expect(result.code).toBe(0);
      expect(parseUnifiedDiff(result.stdout.toString('utf8'))).toEqual([
        {
          path,
          additions: 1,
          deletions: 1,
          hunks: [{ header: '@@ -1 +1 @@', lines: ['--- old heading', '+++ new heading'] }],
        },
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(['\r', '\u2028', '\u2029'])(
    'handles the published advisory line-break class %j',
    (separator) => {
      const path = `name${separator}suffix.txt`;
      const patch = `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
      expect(parseUnifiedDiff(patch)[0]?.path).toBe(path);
    },
  );
  it('keeps header-like content inside a hunk and counts it as content', () => {
    const patch = [
      'diff --git a/example.txt b/example.txt',
      '--- a/example.txt',
      '+++ b/example.txt',
      '@@ -1,2 +1,2 @@ context label',
      '--- old heading',
      '+++ new heading',
      ' unchanged',
      '',
    ].join('\n');
    expect(parseUnifiedDiff(patch)).toEqual([
      {
        path: 'example.txt',
        additions: 1,
        deletions: 1,
        hunks: [
          {
            header: '@@ -1,2 +1,2 @@',
            lines: ['--- old heading', '+++ new heading', ' unchanged'],
          },
        ],
      },
    ]);
  });

  it('decodes Git-quoted file names rather than publishing the quoted path', () => {
    const patch = [
      'diff --git "a/with\\ttab.txt" "b/with\\ttab.txt"',
      '--- "a/with\\ttab.txt"',
      '+++ "b/with\\ttab.txt"',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');
    expect(parseUnifiedDiff(patch)[0]?.path).toBe('with\ttab.txt');
  });

  it('accepts a standard unified patch without a Git preamble', () => {
    expect(parseUnifiedDiff('--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1 @@\n+new\n')).toEqual([
      {
        path: 'file.txt',
        additions: 1,
        deletions: 0,
        hunks: [{ header: '@@ -0,0 +1 @@', lines: ['+new'] }],
      },
    ]);
  });

  it('preserves deletion paths, multiple files and the no-newline display policy', () => {
    const patch = [
      'commit fixture',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
      '\\ No newline at end of file',
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+new',
      '',
    ].join('\n');
    expect(parseUnifiedDiff(patch)).toEqual([
      {
        path: 'gone.txt',
        additions: 0,
        deletions: 1,
        hunks: [{ header: '@@ -1 +0,0 @@', lines: ['-gone'] }],
      },
      {
        path: 'new.txt',
        additions: 1,
        deletions: 0,
        hunks: [{ header: '@@ -0,0 +1 @@', lines: ['+new'] }],
      },
    ]);
  });

  it('keeps metadata-only changes out of the text display, without inventing hunks', () => {
    expect(
      parseUnifiedDiff(
        [
          'diff --git a/old.txt b/new.txt',
          'similarity index 100%',
          'rename from old.txt',
          'rename to new.txt',
          'diff --git a/image.png b/image.png',
          'Binary files a/image.png and b/image.png differ',
          '',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});
