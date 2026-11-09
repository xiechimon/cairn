import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from './test-tmpdir.mjs';

for (const runner of ['test-temp-run.mjs', 'temp-env-run.mjs']) {
  test(`${runner} redirects raw temp allocations to a private disk root with shared locks`, () => {
    const home = makeTestTempDir('env-home-');
    const env = { ...process.env, HOME: home };
    for (const key of ['CAIRN_TEST_TEMP_ROOT', 'CAIRN_HEAVY_SLOTS_DIR', 'TMPDIR']) delete env[key];
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts', runner),
        '--',
        process.execPath,
        '-e',
        `
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const allocation = path.join(os.tmpdir(), 'owned-child');
fs.mkdirSync(allocation);
console.log(JSON.stringify({ root: os.tmpdir(), allocation, slots: process.env.CAIRN_HEAVY_SLOTS_DIR }));
fs.rmSync(allocation, { recursive: true });
process.exitCode = 17;
`,
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(result.status, 17, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.ok(observed.root.startsWith(`${join(home, '.cache/lane-tmp')}/`), observed.root);
    assert.equal(observed.slots, '/tmp/cairn-heavy-slots');
    assert.equal(existsSync(observed.root), false);
    assert.deepEqual(readdirSync(join(home, '.cache/lane-tmp')), []);
  });

  test(`${runner} preserves a shared lock override and refuses a broken temp root`, () => {
    const home = makeTestTempDir('env-refusal-');
    const root = join(home, 'root');
    mkdirSync(root);
    const env = {
      ...process.env,
      CAIRN_TEST_TEMP_ROOT: root,
      CAIRN_HEAVY_SLOTS_DIR: '/shared/locks',
    };
    const result = spawnSync(
      process.execPath,
      [
        resolve('scripts', runner),
        '--',
        process.execPath,
        '-e',
        'console.log(process.env.CAIRN_HEAVY_SLOTS_DIR)',
      ],
      { env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '/shared/locks');
    const broken = join(home, 'file');
    writeFileSync(broken, 'file');
    const refused = spawnSync(
      process.execPath,
      [
        resolve('scripts', runner),
        '--',
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(join(home, 'started'))}, '')`,
      ],
      { env: { ...env, CAIRN_TEST_TEMP_ROOT: broken }, encoding: 'utf8' },
    );
    assert.notEqual(refused.status, 0);
    assert.equal(existsSync(join(home, 'started')), false);
  });
}

test('private root leases use regular files and release them before Windows-style deletion', () => {
  const root = makeTestTempDir('portable-lease-');
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createTempEnvironment } from './packages/shared/src/node/temp-environment.ts';
const opened = new Map();
const open = fs.openSync;
const close = fs.closeSync;
const remove = fs.rmSync;
fs.openSync = (path, ...args) => {
  if (fs.existsSync(path) && fs.statSync(path).isDirectory())
    throw Object.assign(new Error('Windows cannot open a directory'), { code: 'EISDIR' });
  const fd = open(path, ...args);
  opened.set(fd, path);
  return fd;
};
fs.closeSync = (fd) => { close(fd); opened.delete(fd); };
fs.rmSync = (path, ...args) => {
  assert.equal([...opened.values()].some(file => file.startsWith(path + '/')), false,
    'Windows deletion must not encounter an open lease');
  return remove(path, ...args);
};
syncBuiltinESMExports();
const temporary = createTempEnvironment({ CAIRN_TEST_TEMP_ROOT: process.argv[1] });
assert.equal(opened.size, 1);
assert.ok([...opened.values()].every(path => fs.statSync(path).isFile()));
temporary.cleanup();
assert.equal(opened.size, 0);
assert.equal(fs.existsSync(temporary.root), false);
`,
      root,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
