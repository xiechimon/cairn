import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { overlayHarness } from './pr-screens-harness.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const made = [];
after(() => {
  for (const dir of made) releaseTestTempDir(dir);
});

function tree(files) {
  const root = makeTestTempDir('pr-screens-harness-');
  made.push(root);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

const FULL = {
  'apps/web/pr-screens/capture.shots.ts': 'capture',
  'apps/web/pr-screens/live-seed.mjs': 'seed',
  'apps/web/pr-screens/state-pages.ts': 'states',
  'apps/web/e2e/audit-pages.ts': 'pages',
  'apps/web/e2e/helpers.ts': 'helpers',
  'apps/web/playwright.pr-screens.config.ts': 'config',
  'apps/web/playwright.pr-screens-live.config.ts': 'live config',
};

test('the harness is copied onto a tree that predates the live config', () => {
  const to = tree({ 'apps/web/pr-screens/capture.shots.ts': 'old', 'apps/web/package.json': '{}' });
  const copied = overlayHarness(tree(FULL), to);
  assert.ok(copied.includes('apps/web/playwright.pr-screens-live.config.ts'));
  assert.equal(readFileSync(join(to, 'apps/web/pr-screens/capture.shots.ts'), 'utf8'), 'capture');
  assert.equal(
    readFileSync(join(to, 'apps/web/playwright.pr-screens-live.config.ts'), 'utf8'),
    'live config',
  );
});

test('a harness without the live files skips them instead of failing', () => {
  const { 'apps/web/playwright.pr-screens-live.config.ts': _config, ...rest } = FULL;
  const to = tree({ 'apps/web/package.json': '{}' });
  const copied = overlayHarness(tree(rest), to);
  assert.ok(copied.includes('apps/web/playwright.pr-screens.config.ts'));
  assert.equal(existsSync(join(to, 'apps/web/playwright.pr-screens-live.config.ts')), false);
});

test('an empty harness copies nothing and does not throw', () => {
  assert.deepEqual(overlayHarness(tree({}), tree({})), []);
});
