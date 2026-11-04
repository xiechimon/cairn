import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { scrubGitEnv } from './scrub-git-env.mjs';

test('drops repo-binding GIT_* variables and keeps the rest', () => {
  const env = scrubGitEnv({
    GIT_DIR: '/x/.git',
    GIT_INDEX_FILE: '/x/idx',
    GIT_EDITOR: 'true',
    PATH: '/bin',
  });
  assert.deepEqual(env, { GIT_EDITOR: 'true', PATH: '/bin' });
});

test('vitest config scrubs the git hook environment before workers spawn', () => {
  const run = spawnSync(
    process.execPath,
    ['-e', "await import('./vitest.config.ts'); console.log(process.env.GIT_DIR ?? 'unset')"],
    { encoding: 'utf8', env: { ...process.env, GIT_DIR: '/nonexistent/.git' } },
  );
  assert.equal(run.stdout.trim(), 'unset', run.stderr);
});
