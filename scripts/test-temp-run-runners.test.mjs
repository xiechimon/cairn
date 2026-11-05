import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fixture, leaked } from './test-temp-run-fixture.mjs';

for (const mode of ['vitest', 'playwright']) {
  test(`${mode} skipped cleanup fails the supervising run without needing a browser`, () => {
    const moduleUrl = import.meta.resolve(mode === 'vitest' ? 'vitest' : '@playwright/test');
    const run = fixture(
      `import { test } from ${JSON.stringify(moduleUrl)};\n${leaked.replace('const home =', "test('leaks', () => {\nconst home =")}\n});`,
      mode,
    );
    try {
      assert.ok(run.allocation, run.result.stderr + run.result.stdout);
      assert.equal(run.result.status, 1, run.result.stderr);
      assert.match(run.result.stderr, /survivor/);
      assert.equal(existsSync(run.allocation.home), false);
    } finally {
      run.cleanup();
    }
  });
}

for (const mode of ['vitest', 'playwright']) {
  test(`${mode} explicit cleanup leaves a successful run successful`, () => {
    const moduleUrl = import.meta.resolve(mode === 'vitest' ? 'vitest' : '@playwright/test');
    const run = fixture(
      `import { test } from ${JSON.stringify(moduleUrl)};
import { makeTestTempDir, releaseTestTempDir } from ${JSON.stringify(new URL('./test-tmpdir.mjs', import.meta.url).href)};
test('releases its home', () => {
  const home = makeTestTempDir('clean-');
  console.log('TEMP:' + JSON.stringify({ home, runId: process.env.CAIRN_TEST_RUN_ID }));
  releaseTestTempDir(home);
});`,
      mode,
    );
    try {
      assert.ok(run.allocation, run.result.stderr + run.result.stdout);
      assert.equal(run.result.status, 0, run.result.stderr);
      assert.equal(existsSync(run.allocation.home), false);
    } finally {
      run.cleanup();
    }
  });
}
