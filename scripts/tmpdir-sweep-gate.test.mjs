import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { cleanupTestDirs, makeTestTempDir } from './test-tmpdir.mjs';
import { finishSweep } from './tmpdir-sweep.mjs';
import { configViolations, sweepViolations } from './tmpdir-sweep-gate.mjs';

const creator = 'mkd' + 'tempSync';

const RAW_TEST = `import { ${creator} } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';

test('journal lifecycle', () => {
  const dir = ${creator}(join(tmpdir(), 'cairn-journal-'));
});
`;

const HELPER_TEST = `import { test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';

test('journal lifecycle', () => {
  makeTestTempDir('cairn-journal');
});
`;

function sandbox() {
  return makeTestTempDir('tmpdir-sweep-test');
}

test('a test that calls mkdtemp is one violation and a helper call is clean', () => {
  const root = sandbox();
  try {
    mkdirSync(join(root, 'apps/daemon/test'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'apps/daemon/test/journal.test.ts'), RAW_TEST);
    writeFileSync(join(root, 'scripts/tool.mjs'), RAW_TEST);
    const violations = sweepViolations(
      ['apps/daemon/test/journal.test.ts', 'scripts/tool.mjs'],
      root,
    );
    assert.equal(violations.length, 1, JSON.stringify(violations));
    assert.equal(violations[0].line, 7);
    assert.match(violations[0].message, /makeTestTempDir/);
    writeFileSync(join(root, 'apps/daemon/test/journal.test.ts'), HELPER_TEST);
    assert.deepEqual(sweepViolations(['apps/daemon/test/journal.test.ts'], root), []);
  } finally {
    cleanupTestDirs([root]);
  }
});

test('a temp dir that skips cleanup fails the sweep and is removed', () => {
  const dir = makeTestTempDir('cairn-sweep-leak');
  const manifest = join(tmpdir(), `cairn-tmp-manifest-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(manifest, `${dir}\n`);
    assert.throws(() => finishSweep(manifest), /1 test temp dir\(s\) were not removed/);
    assert.equal(existsSync(dir), false);
  } finally {
    rmSync(manifest, { force: true });
    cleanupTestDirs([dir]);
  }
});

test('a temp dir removed before the sweep does not fail it', () => {
  const dir = makeTestTempDir('cairn-sweep-clean');
  const manifest = join(tmpdir(), `cairn-tmp-manifest-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(manifest, `${dir}\n/etc/passwd\n`);
    cleanupTestDirs([dir]);
    assert.equal(existsSync(dir), false);
    assert.equal(existsSync('/etc/passwd'), true);
    assert.deepEqual(finishSweep(manifest), []);
    assert.equal(existsSync('/etc/passwd'), true);
  } finally {
    rmSync(manifest, { force: true });
    cleanupTestDirs([dir]);
  }
});

test('project configs must load the temp dir setup', () => {
  const root = sandbox();
  try {
    const missing = configViolations(root);
    assert.ok(missing.some((item) => item.file === 'vitest.config.ts'));
    assert.ok(missing.some((item) => item.file === 'apps/server/vitest.config.ts'));
    writeFileSync(join(root, 'vitest.config.ts'), "globalSetup: ['./scripts/tmpdir-sweep.mjs']\n");
    for (const file of [
      'apps/daemon/vitest.config.ts',
      'apps/server/vitest.config.ts',
      'apps/web/vitest.config.ts',
      'integration/vitest.config.ts',
      'packages/shared/vitest.config.ts',
    ]) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), "setupFiles: ['../../scripts/tmpdir-setup.mjs']\n");
    }
    assert.deepEqual(configViolations(root), []);
  } finally {
    cleanupTestDirs([root]);
  }
});

test('the gate passes on this repository and names its file count', () => {
  const result = execFileSync(process.execPath, [resolve('scripts/tmpdir-sweep-gate.mjs')], {
    encoding: 'utf8',
  });
  assert.match(result, /\[tmpdir-sweep-gate\] PASS \(\d+ test files\)/);
});
