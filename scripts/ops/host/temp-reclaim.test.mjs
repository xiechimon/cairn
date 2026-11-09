import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, lstatSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTempEnvironment } from '../../../packages/shared/src/node/temp-environment.ts';
import { makeTestTempDir } from '../../test-tmpdir.mjs';
import { runGuard } from './tools/test-temp-guard.mjs';

const now = Date.now();
const hours = 3_600_000;
function fixture() {
  const home = makeTestTempDir('reclaim-');
  const root = join(home, 'lane-tmp');
  mkdirSync(root);
  const processRoot = join(home, 'proc');
  mkdirSync(processRoot);
  symlinkSync(`/proc/${process.pid}`, join(processRoot, String(process.pid)));
  return {
    home,
    root,
    options: {
      roots: [root],
      processRoot,
      diskRoot: root,
      stateDir: join(home, 'state'),
      now,
      usage: () => ({ space: 0, inodes: 0 }),
    },
  };
}
function directory(root, name, age, ssr = true) {
  const path = join(root, name);
  mkdirSync(path);
  if (ssr) mkdirSync(join(path, 'ssr'));
  utimesSync(path, (now - age) / 1000, (now - age) / 1000);
  return path;
}

test('reclaims only Vitest-shaped nanoids older than six hours, never symlink ssr or unrelated names', () => {
  const { root, options } = fixture();
  const old = directory(root, 'a'.repeat(21), 6 * hours + 1);
  const boundary = directory(root, 'b'.repeat(21), 6 * hours);
  const fractionalCutoff = (now - 6 * hours) / 1000 - 0.000001;
  utimesSync(boundary, fractionalCutoff, fractionalCutoff);
  const fresh = directory(root, 'c'.repeat(21), 3 * hours);
  const unrelated = directory(root, 'd'.repeat(21), 7 * hours, false);
  const linked = directory(root, 'e'.repeat(21), 7 * hours, false);
  symlinkSync(join(old, 'ssr'), join(linked, 'ssr'));
  utimesSync(linked, 0, 0);
  runGuard({ ...options, now: lstatSync(boundary).mtimeMs + 6 * hours });
  assert.equal(existsSync(old), false);
  for (const path of [boundary, fresh, unrelated, linked])
    assert.equal(existsSync(path), true, path);
});

for (const mode of ['cwd', 'fd']) {
  test(`keeps stale nanoids and private roots used as a live process ${mode}`, async () => {
    const { root, options } = fixture();
    for (const name of ['f'.repeat(21), 'ct-busy']) {
      const path = directory(root, name, 7 * hours);
      writeFileSync(join(path, 'ssr', 'open'), 'data');
      const child = spawn(
        process.execPath,
        [
          '-e',
          mode === 'cwd'
            ? 'process.chdir(process.argv[1]);console.log("ready");setInterval(()=>{},1000)'
            : 'require("node:fs").openSync(process.argv[1],"r");console.log("ready");setInterval(()=>{},1000)',
          join(path, 'ssr', ...(mode === 'fd' ? ['open'] : [])),
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      symlinkSync(`/proc/${child.pid}`, join(options.processRoot, String(child.pid)));
      const exit = once(child, 'exit');
      try {
        await once(child.stdout, 'data');
        runGuard(options);
        assert.equal(existsSync(path), true, path);
      } finally {
        child.kill();
        await exit;
      }
      runGuard(options);
      assert.equal(existsSync(path), false, path);
    }
  });
}

test('caps disk roots by oldest non-live first, even before the age threshold', async () => {
  const { root, options } = fixture();
  const oldest = directory(root, 'manual-oldest', 3 * hours, false);
  const newer = directory(root, 'ct-newer', hours, false);
  const live = directory(root, 'ct-live', 4 * hours, false);
  for (const path of [oldest, newer, live]) {
    writeFileSync(join(path, 'bytes'), Buffer.alloc(8192));
    const age = path === live ? 4 * hours : path === oldest ? 3 * hours : hours;
    utimesSync(path, (now - age) / 1000, (now - age) / 1000);
  }
  const child = spawn(
    process.execPath,
    ['-e', 'process.chdir(process.argv[1]);console.log("ready");setInterval(()=>{},1000)', live],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  symlinkSync(`/proc/${child.pid}`, join(options.processRoot, String(child.pid)));
  const exit = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const result = runGuard({ ...options, maxDiskBytes: 20_000 });
    assert.equal(existsSync(oldest), false);
    assert.equal(existsSync(newer), true);
    assert.equal(existsSync(live), true);
    assert.ok(result.diskBytes <= 20_000);
    const warnings = [];
    const pinned = runGuard({
      ...options,
      maxDiskBytes: 1,
      warn: (message) => warnings.push(message),
    });
    assert.ok(pinned.diskBytes > 1);
    assert.ok(warnings.some((message) => message.includes('over limit')));
    assert.equal(existsSync(live), true);
  } finally {
    child.kill();
    await exit;
  }
});

test('an unreadable process inspection preserves stale roots and over-cap roots', () => {
  const { home, root, options } = fixture();
  const path = directory(root, 'ct-uncertain', 7 * hours);
  writeFileSync(join(path, 'bytes'), 'keep');
  const proc = join(home, 'unreadable-proc');
  const pid = join(proc, '123');
  mkdirSync(join(pid, 'fd'), { recursive: true });
  symlinkSync(home, join(pid, 'cwd'));
  mkdirSync(join(pid, 'maps'));
  runGuard({ ...options, processRoot: proc, maxDiskBytes: 0, warn() {} });
  assert.equal(existsSync(path), true);
});

test('a private root keeps its idle owner protected by a directory descriptor', () => {
  const { root, options } = fixture();
  const temporary = createTempEnvironment({ CAIRN_TEST_TEMP_ROOT: root });
  try {
    writeFileSync(join(temporary.root, 'data'), 'in use');
    utimesSync(temporary.root, 0, 0);
    runGuard({ ...options, maxDiskBytes: 0, warn() {} });
    assert.equal(existsSync(temporary.root), true);
  } finally {
    temporary.cleanup();
  }
  assert.equal(existsSync(temporary.root), false);
});
