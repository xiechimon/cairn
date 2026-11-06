import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

const screensRoot = new URL('../apps/web/pr-screens/', import.meta.url);
const instant = '2026-10-31T06:00:00.000Z';

function serverDates() {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        new URL('fixed-clock.mjs', screensRoot).href,
        '--input-type=module',
        '-e',
        `const before = performance.now();
        await new Promise(resolve => setTimeout(resolve, 25));
        console.log(JSON.stringify({
          now: Date.now(), date: new Date().toISOString(), callable: Date(),
          explicit: new Date('2000-01-01').toISOString(),
          parts: new Date(2000, 0, 1).getFullYear(),
          parsed: Date.parse('2000-01-01'), utc: Date.UTC(2000, 0, 1),
          instance: new Date() instanceof Date, elapsed: performance.now() - before
        }));`,
      ],
      { encoding: 'utf8' },
    ),
  );
}

test('independent seeded servers persist the same instant while timers advance', async () => {
  const first = serverDates();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = serverDates();
  for (const result of [first, second]) {
    assert.equal(result.now, Date.parse(instant));
    assert.equal(result.date, instant);
    assert.equal(Date.parse(result.callable), Date.parse(instant));
    assert.equal(result.explicit, '2000-01-01T00:00:00.000Z');
    assert.equal(result.parts, 2000);
    assert.equal(result.parsed, 946684800000);
    assert.equal(result.utc, 946684800000);
    assert.equal(result.instance, true);
    assert.ok(result.elapsed >= 20);
  }
});

test('browser and isolated server share the clock; comparisons remain pixel-exact', async () => {
  const { FROZEN_AT } = await import(new URL('frozen-time.mjs', screensRoot));
  assert.equal(new Date(FROZEN_AT).toISOString(), instant);
  const capture = readFileSync(new URL('capture-core.ts', screensRoot), 'utf8');
  assert.match(capture, /import \{ FROZEN_AT \} from '\.\/frozen-time\.mjs'/);
  assert.match(capture, /setFixedTime\(FROZEN_AT\)/);
  const launcher = readFileSync(new URL('live-world.mjs', screensRoot), 'utf8');
  assert.match(launcher, /--import .*fixed-clock\.mjs/);
  assert.match(
    readFileSync(new URL('compare.shots.ts', screensRoot), 'utf8'),
    /maxDiffPixelRatio: 0/,
  );
});
