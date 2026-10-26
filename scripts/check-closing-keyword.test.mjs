import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

import { resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

const script = resolve('scripts/check-closing-keyword.mjs');

test('requires each declared issue to have a closing line in branch commits', () => {
  const cwd = makeTestTempDir('closing-keyword-');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('commit', '--allow-empty', '-m', 'baseline\n\ncloses #1541');
    const base = git('rev-parse', 'HEAD');
    git('commit', '--allow-empty', '-m', 'implementation\n\ncloses #15410');
    const run = (body) => {
      const event = resolve(cwd, 'event.json');
      writeFileSync(
        event,
        JSON.stringify({
          pull_request: {
            body,
            base: { sha: base },
            head: { sha: git('rev-parse', 'HEAD') },
          },
        }),
      );
      return spawnSync(process.execPath, [script], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_PATH: event },
      });
    };
    let result = run('## Issues\nCloses #1541');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /#1541\b/);
    console.log(`Missing closing line: exit ${result.status}; ${result.stderr.trim()}`);
    git('commit', '--allow-empty', '-m', 'closing lines\n\nCloses #1541, closes #1542');
    result = run('## Issues\nCloses #1541, closes #1542');
    assert.equal(result.status, 0, result.stderr);
    console.log(`Matching closing lines: exit ${result.status}; ${result.stdout.trim()}`);
    result = run('## Issues\nCloses #1541, closes #1543');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /#1543/);
    assert.doesNotMatch(result.stderr, /#1541/);
    assert.equal(run('## Issues\nRelated to #1543').status, 0);
    git('commit', '--allow-empty', '-m', 'mentions closes #1543 in prose');
    assert.equal(run('## Issues\nCloses #1543').status, 1);
    git('commit', '--allow-empty', '-m', 'follow-up\n\ncloses #1543');
    assert.equal(run('## Issues\nCloses #1543').status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
