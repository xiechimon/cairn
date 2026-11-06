import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../.github/workflows/pr-screens.yml'),
  'utf8',
);
const capture = workflow.slice(workflow.indexOf('  capture:'), workflow.indexOf('  compare:'));

test('the base side is a clean merge-base worktree, never head with some sources swapped', () => {
  assert.match(
    capture,
    /git worktree add --detach "\$tree" "\$\(git merge-base "\$BASE_SHA" HEAD\)"/,
  );
  assert.doesNotMatch(capture, /git checkout [^\n]*--/);
});

test('each side installs, installs its browser, runs and uploads from its own tree', () => {
  const treeSteps = [
    'Install dependencies from this side',
    "Install Playwright chromium for this side's version",
    'Screenshot the selected pages and run axe',
    'Screenshot the selected key states on a seeded server',
    'Record the lockfile this side was built from',
  ];
  for (const name of treeSteps) {
    const at = capture.indexOf(name);
    assert.ok(at > -1, name);
    const step = capture.slice(at, capture.indexOf('\n      - ', at + 1));
    assert.match(step, /working-directory: \$\{\{ steps\.tree\.outputs\.tree \}\}/, name);
  }
  assert.match(
    capture,
    /path: \$\{\{ steps\.tree\.outputs\.tree \}\}\/apps\/web\/pr-screens-out\//,
  );
});

test('both sides get the harness from one checkout of the workflow merge ref, not from the PR head', () => {
  assert.match(capture, /path: \.pr-screens-harness/);
  assert.match(
    capture,
    /node \.pr-screens-harness\/scripts\/pr-screens-harness\.mjs \.pr-screens-harness "\$tree"/,
  );
  assert.equal(capture.split('\n').filter((line) => /^\s+cp /.test(line)).length, 0);
});
