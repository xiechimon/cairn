import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTestTempRun, makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const moduleUrl = new URL('./test-tmpdir.mjs', import.meta.url).href;

test('release removes populated allocations and repeated release is harmless', () => {
  const run = createTestTempRun();
  const dir = run.allocate('populated-');
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'nested/file'), 'data');
  assert.equal(run.release(dir), true);
  assert.equal(existsSync(dir), false);
  assert.equal(run.release(dir), false);
  run.cleanup();
  run.cleanup();
});

test('explicit cleanup works after an exception and allows later allocations', () => {
  const run = createTestTempRun();
  let dir;
  assert.throws(() => {
    try {
      dir = run.allocate();
      throw new Error('fixture failed');
    } finally {
      run.cleanup();
    }
  }, /fixture failed/);
  assert.equal(existsSync(dir), false);
  const later = run.allocate();
  run.cleanup();
  assert.equal(existsSync(later), false);
});

test('concurrent identities and matching identities cannot release unallocated paths', () => {
  const first = createTestTempRun();
  const second = createTestTempRun();
  const inherited = createTestTempRun({ runId: first.runId });
  const caller = mkdtempSync(join(tmpdir(), 'caller-owned-'));
  const dir = first.allocate();
  try {
    assert.notEqual(first.runId, second.runId);
    for (const run of [second, inherited]) {
      assert.equal(run.release(dir), false);
      assert.equal(run.release(caller), false);
      run.cleanup();
    }
    assert.equal(first.release(join(dir, '..')), false);
    assert.equal(first.release(join(dir, 'nested')), false);
    assert.equal(existsSync(dir), true);
    assert.equal(existsSync(caller), true);
  } finally {
    first.cleanup();
    rmSync(caller, { recursive: true, force: true });
  }
});

test('allocation rejects path separators and invalid run identities', () => {
  const run = createTestTempRun();
  for (const prefix of ['../outside-', '/absolute-', 'nested/path-', 'nested\\path-']) {
    assert.throws(() => run.allocate(prefix), /prefix/);
  }
  assert.throws(() => createTestTempRun({ runId: '../outside' }), /runId/);
});

test('plain Node and node --test import without runner packages and clean up on exit', () => {
  const run = createTestTempRun();
  const fixture = join(run.allocate(), 'child.test.mjs');
  const source = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeTestTempDir, testTempRunId } from ${JSON.stringify(moduleUrl)};
assert.equal(testTempRunId, process.env.CAIRN_TEST_RUN_ID);
assert.ok(!Object.keys(createRequire(import.meta.url).cache).some(p => /vitest|playwright/.test(p)));
console.log('ALLOCATION:' + JSON.stringify({ dir: makeTestTempDir(), runId: testTempRunId }));`;
  writeFileSync(fixture, source);
  try {
    const env = { ...process.env, ...run.env };
    delete env.NODE_TEST_CONTEXT;
    for (const args of [[fixture], ['--test', '--test-reporter=tap', fixture]]) {
      const result = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        env,
        timeout: 10_000,
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      const allocation = JSON.parse(result.stdout.match(/ALLOCATION:(\{[^\n]+\})/)[1]);
      assert.equal(allocation.runId, run.runId);
      assert.ok(allocation.dir.includes(run.runId));
      assert.equal(existsSync(allocation.dir), false);
    }
  } finally {
    run.cleanup();
  }
});

test('an uncaught exception still triggers exit cleanup', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { makeTestTempDir } from ${JSON.stringify(moduleUrl)};
console.log(makeTestTempDir());
throw new Error('uncaught fixture failure');`,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /uncaught fixture failure/);
  assert.equal(existsSync(result.stdout.trim()), false);
});

test('SIGKILL bypasses exit cleanup and requires external removal', async () => {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { makeTestTempDir } from ${JSON.stringify(moduleUrl)};
console.log(makeTestTempDir());
setInterval(() => {}, 1000);`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let dir;
  const exited = once(child, 'exit');
  try {
    const [output] = await once(child.stdout, 'data');
    dir = output.toString().trim();
    assert.equal(existsSync(dir), true);
    child.kill('SIGKILL');
    const [code, signal] = await exited;
    assert.equal(code, null);
    assert.equal(signal, 'SIGKILL');
    assert.equal(existsSync(dir), true);
  } finally {
    child.kill('SIGKILL');
    await exited;
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test('default allocation and release are available without lifecycle adapters', () => {
  const dir = makeTestTempDir();
  assert.equal(releaseTestTempDir(dir), true);
  assert.equal(existsSync(dir), false);
});
