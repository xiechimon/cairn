import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
const HELPER = join(REPO, 'scripts/test-tmpdir.mjs');
const SETUP = join(REPO, 'apps/server/test/tmpdir-cleanup-setup.ts');
const SERVER_CONFIG = join(REPO, 'apps/server/vitest.config.ts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

function runFixture(withSetup: boolean) {
  const root = makeTestTempDir('tmpdir-cleanup-fixture-');
  roots.push(root);
  const allocated = join(root, 'allocated-path');
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    `export default { test: { setupFiles: ${withSetup ? JSON.stringify([SETUP]) : '[]'} } };\n`,
  );
  writeFileSync(
    join(root, 'leak.test.mjs'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { test } from 'vitest';",
      `import { makeTestTempDir } from ${JSON.stringify(HELPER)};`,
      `test('allocates without releasing', () => { writeFileSync(${JSON.stringify(allocated)}, makeTestTempDir('fixture-')); });`,
      '',
    ].join('\n'),
  );
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--root', root, '--config', join(root, 'vitest.config.mjs')],
    {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, CAIRN_TEST_TEMP_ROOT: root },
    },
  );
  return { status: result.status, survivor: existsSync(readFileSync(allocated, 'utf8')) };
}

describe('server vitest project cleanup', () => {
  test('is registered as a setup file of the server project', () => {
    expect(readFileSync(SERVER_CONFIG, 'utf8')).toContain('tmpdir-cleanup-setup.ts');
  });

  test('without the setup file a test that never releases its directory leaves it behind', () => {
    const { status, survivor } = runFixture(false);
    expect(status).toBe(0);
    expect(survivor).toBe(true);
  }, 120_000);

  test('with the setup file the directory is removed when the test file finishes', () => {
    const { status, survivor } = runFixture(true);
    expect(status).toBe(0);
    expect(survivor).toBe(false);
  }, 120_000);
});
