import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import test from 'node:test';
import { fixture, helper, leaked, runner } from './test-temp-run-fixture.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

test('the supervised layout keeps the longest fixture socket path under the unix limit', () => {
  const run =
    fixture(`import { makeTestTempDir, releaseTestTempDir } from ${JSON.stringify(helper)};
const home = makeTestTempDir('cif-');
console.log('TEMP:' + JSON.stringify({ home, runId: process.env.CAIRN_TEST_RUN_ID }));
releaseTestTempDir(home);`);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    const longestSocketTail = '/c1/computer.sock'.length;
    assert.ok(
      Buffer.byteLength(run.allocation.home) + longestSocketTail < 108 - 8,
      `${run.allocation.home} leaves too little room for a socket path`,
    );
  } finally {
    run.cleanup();
  }
});

test('an exit-zero child with skipped cleanup fails and its survivor is reclaimed', () => {
  const run = fixture(leaked);
  try {
    assert.ok(run.allocation, run.result.stderr);
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.match(run.result.stderr, /survivor/);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('a node --test child with skipped cleanup fails its supervising run', () => {
  const run = fixture(
    `import test from 'node:test';\n${leaked.replace('const home =', "test('leaks', () => {\nconst home =")}\n});`,
    'node-test',
  );
  try {
    assert.ok(run.allocation, run.result.stderr);
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('SIGKILL leaves a helper allocation that the supervisor reports and reclaims', () => {
  const run = fixture(`import { makeTestTempDir } from ${JSON.stringify(helper)};
const home = makeTestTempDir('killed-');
console.log('TEMP:' + JSON.stringify({ home, runId: process.env.CAIRN_TEST_RUN_ID }));
process.kill(process.pid, 'SIGKILL');`);
  try {
    assert.ok(run.allocation, run.result.stderr);
    assert.notEqual(run.result.status, 0);
    assert.match(run.result.stderr, /survivor/);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('a fresh child identity cannot reclaim the supervising test run directories', () => {
  const foreign = makeTestTempDir('foreign-');
  const run =
    fixture(`import { makeTestTempDir, releaseTestTempDir } from ${JSON.stringify(helper)};
const home = makeTestTempDir('clean-');
console.log('TEMP:' + JSON.stringify({ home, runId: process.env.CAIRN_TEST_RUN_ID }));
releaseTestTempDir(home);`);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.notEqual(run.allocation.runId, process.env.CAIRN_TEST_RUN_ID);
    assert.equal(existsSync(foreign), true);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
    releaseTestTempDir(foreign);
  }
});

test('a nonzero child exit remains nonzero without survivors', () => {
  const run = fixture('process.exit(23);');
  try {
    assert.equal(run.result.status, 23, run.result.stderr);
  } finally {
    run.cleanup();
  }
});

test('a nested supervisor leaves its still-running parent allocation alone', () => {
  const run = fixture(`${leaked}
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const nested = spawnSync(process.execPath, [${JSON.stringify(runner)}, '--', process.execPath, '-e', 'process.exit(0)'], { stdio: 'inherit' });
if (nested.status !== 0 || !existsSync(home)) process.exit(24);
console.log('PARENT_ALLOCATION_PRESERVED');`);
  try {
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.match(run.result.stdout, /PARENT_ALLOCATION_PRESERVED/);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('invalid invocation is rejected before starting a child', () => {
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

test('a killed explicit helper subrun remains owned by its supervising run', () => {
  const run = fixture(`import { createTestTempRun } from ${JSON.stringify(helper)};
const isolated = createTestTempRun();
const home = isolated.allocate('subrun-');
console.log('TEMP:' + JSON.stringify({ home, runId: isolated.runId }));
process.kill(process.pid, 'SIGKILL');`);
  try {
    assert.ok(run.allocation, run.result.stderr);
    assert.notEqual(run.result.status, 0);
    assert.match(run.result.stderr, /survivor/);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('SIGKILL between directory creation and registration cannot escape run ownership', () => {
  const run = fixture(`import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createTestTempRun } from ${JSON.stringify(helper)};
const allocate = fs.mkdtempSync;
fs.mkdtempSync = (prefix) => {
  const home = allocate(prefix);
  fs.writeSync(1, 'TEMP:' + JSON.stringify({ home, runId: process.env.CAIRN_TEST_RUN_ID }) + '\\n');
  process.kill(process.pid, 'SIGKILL');
  return home;
};
syncBuiltinESMExports();
createTestTempRun().allocate('interrupted-');`);
  try {
    assert.ok(run.allocation, run.result.stderr);
    assert.notEqual(run.result.status, 0);
    assert.match(run.result.stderr, /survivor/);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

function killFixtureProcessGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

test('interruption reaps a worker that ignores termination and reclaims its private root', async () => {
  const source = `process.on('SIGTERM', () => {});
console.log(JSON.stringify({ pid: process.pid, root: process.env.CAIRN_TEST_TEMP_ROOT }));
setInterval(() => {}, 1000);`;
  const supervisor = spawn(process.execPath, [runner, '--', process.execPath, '-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(supervisor, 'exit');
  let child;
  let timer;
  try {
    const [output] = await once(supervisor.stdout, 'data');
    child = JSON.parse(output.toString());
    supervisor.kill('SIGTERM');
    const result = await Promise.race([
      exited,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), 2500);
      }),
    ]);
    assert.notEqual(result, 'timeout', 'supervisor did not terminate its signal-resistant worker');
    assert.equal(existsSync(child.root), false);
  } finally {
    clearTimeout(timer);
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL');
    if (child) {
      killFixtureProcessGroup(child.pid);
      rmSync(child.root, { recursive: true, force: true });
    }
    await exited;
  }
});

test('runtime caches are owned cleanup rather than helper allocation leaks', () => {
  const run = fixture(`import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
for (const name of ['tsx-' + process.getuid(), 'node-compile-cache', 'a'.repeat(21), 'cairn-emulate-npm-cache']) {
  fs.mkdirSync(path.join(os.tmpdir(), name), { recursive: true });
}
console.log('TEMP:' + JSON.stringify({ home: process.env.CAIRN_TEST_TEMP_ROOT, runId: process.env.CAIRN_TEST_RUN_ID }));`);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('an interrupted nested runtime root remains owned by its supervising run', () => {
  const run =
    fixture(`import { createTempEnvironment } from ${JSON.stringify(new URL('../packages/shared/src/node/temp-environment.ts', import.meta.url).href)};
console.log('TEMP:' + JSON.stringify({ home: process.env.CAIRN_TEST_TEMP_ROOT, runId: process.env.CAIRN_TEST_RUN_ID }));
createTempEnvironment();`);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});

test('nested runtime ownership survives a child TMPDIR override', () => {
  const run =
    fixture(`import { createTempEnvironment } from ${JSON.stringify(new URL('../packages/shared/src/node/temp-environment.ts', import.meta.url).href)};
console.log('TEMP:' + JSON.stringify({ home: process.env.CAIRN_TEST_TEMP_ROOT, runId: process.env.CAIRN_TEST_RUN_ID }));
process.env.TMPDIR = process.env.CAIRN_TEST_TEMP_ROOT;
createTempEnvironment();`);
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(existsSync(run.allocation.home), false);
  } finally {
    run.cleanup();
  }
});
