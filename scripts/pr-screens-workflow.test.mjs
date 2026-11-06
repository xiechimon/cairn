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

test('only the harness is copied from head into the base tree', () => {
  const copies = capture.split('\n').filter((line) => /^\s+cp /.test(line));
  assert.deepEqual(
    copies.map((line) => line.trim().replace(/"\$tree\/[^"]*"/g, 'TREE')),
    [
      'cp apps/web/pr-screens/* TREE',
      'cp apps/web/e2e/audit-pages.ts apps/web/e2e/helpers.ts TREE',
      'cp apps/web/playwright.pr-screens.config.ts apps/web/playwright.pr-screens-live.config.ts "$tree/apps/web/"',
    ].map((line) => line.replace(/"\$tree\/[^"]*"/g, 'TREE')),
  );
});
