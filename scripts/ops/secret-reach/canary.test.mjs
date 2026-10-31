import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { channels, parseOptions, runCanary } from './canary.mjs';

const cli = fileURLToPath(new URL('./canary.mjs', import.meta.url));
const marker = 'TEMPORARY_CANARY_CONTENT_2189';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'secret-reach-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "secret with spaces ' $(touch SHOULD_NOT_EXIST)");
  writeFileSync(path, marker);
  return { dir, path };
}

test('profiles include all issue paths and explicit paths replace the defaults', () => {
  assert.deepEqual(channels, [
    'direct',
    'symlink',
    'python',
    'node',
    'sh',
    'subprocess-file',
    'git-config',
    'git-credential',
  ]);
  const defaults = parseOptions(['--pid', '123'], {});
  assert.deepEqual(defaults.paths, [
    '/home/ian/.cairn/cairnwright.private-key.pem',
    '/mnt/fast/cairn/server/secretbox.key',
    '/home/ian/.cairn/server.hdd-old/secretbox.key',
    '/home/ian/.config/cairn/server.env',
    '/home/ian/.cairn/token',
    '/mnt/fast/cairn/server/server.db',
    '/home/ian/.cairn/server.hdd-old/server.db',
  ]);
  assert.ok(
    parseOptions(['--profile', 'mac'], {}, '/fixture').paths.includes(
      '/fixture/.cairn/server/secretbox.key',
    ),
  );
  assert.deepEqual(parseOptions(['--path', '/fixture', '--pid', '1'], {}).paths, ['/fixture']);
  assert.deepEqual(parseOptions(['--pid', '1'], { SECRET_REACH_PATHS: '["/fixture"]' }).paths, [
    '/fixture',
  ]);
  for (const args of [['--pid', 'x'], ['--profile', 'unknown'], ['--path'], ['--unknown']]) {
    assert.throws(() => parseOptions(args, {}));
  }
});

test('every file channel reports only metadata; subprocess files contain counts, never contents', async (t) => {
  const f = fixture(t);
  const rows = [];
  const result = await runCanary({
    paths: [f.path],
    procPaths: [],
    scratchParent: f.dir,
    emit: (row) => {
      rows.push(row);
      if (row.channel === 'subprocess-file') {
        const scratch = readdirSync(f.dir).find((name) => name.startsWith('secret-reach-probes-'));
        assert.equal(
          readFileSync(join(f.dir, scratch, 'count'), 'utf8'),
          String(Buffer.byteLength(marker)),
        );
      }
    },
    env: {
      PATH: process.env.PATH,
      HOME: f.dir,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  assert.equal(result, 1);
  assert.deepEqual(
    rows.map((row) => row.channel),
    channels,
  );
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ['channel', 'path', 'readable', 'bytes']);
    assert.equal(row.path, f.path);
    if (['git-config', 'git-credential'].includes(row.channel)) continue;
    assert.equal(row.readable, 'yes', row.channel);
    assert.equal(row.bytes, Buffer.byteLength(marker), row.channel);
  }
  assert.ok(!JSON.stringify(rows).includes(marker));
  assert.deepEqual(readdirSync(f.dir), [f.path.slice(f.dir.length + 1)]);
  assert.equal(readFileSync(f.path, 'utf8'), marker);
});

test('blocked paths and proc files are green and inaccessible helpers cannot hide an earlier leak', async (t) => {
  const f = fixture(t);
  const rows = [];
  const missing = join(f.dir, 'missing');
  assert.equal(
    await runCanary({
      paths: [missing],
      procPaths: [missing, `${missing}-mem`],
      scratchParent: f.dir,
      emit: (row) => rows.push(row),
      env: {
        PATH: process.env.PATH,
        HOME: f.dir,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }),
    0,
  );
  assert.equal(rows.length, channels.length + 2);
  assert.ok(rows.every((row) => row.readable === 'no' && row.bytes === 0));
  writeFileSync(join(f.dir, 'environment'), marker);
  assert.equal(
    await runCanary({
      paths: [],
      procPaths: [join(f.dir, 'environment')],
      scratchParent: f.dir,
      emit: () => {},
    }),
    1,
  );
});

test('git config and credential helper outputs are counted without exposing values', async (t) => {
  const f = fixture(t);
  const config = join(f.dir, 'gitconfig');
  writeFileSync(
    config,
    `[credential]\n helper = "!printf 'username=fixture\\npassword=${marker}\\n'"\n[secret]\n value = ${marker}\n`,
  );
  const rows = [];
  assert.equal(
    await runCanary({
      paths: [config],
      procPaths: [],
      scratchParent: f.dir,
      emit: (row) => rows.push(row),
      env: {
        PATH: process.env.PATH,
        HOME: f.dir,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }),
    1,
  );
  for (const name of ['git-config', 'git-credential']) {
    assert.ok(rows.find((row) => row.channel === name).bytes > 0);
  }
  assert.ok(!JSON.stringify(rows).includes(marker));
});

test('CLI fails closed for missing interpreters and prints no child diagnostics', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [cli, '--profile', 'mac', '--path', f.path], {
    encoding: 'utf8',
    env: { HOME: f.dir, PATH: f.dir },
  });
  assert.equal(result.status, 2);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(marker));
});

test('a vanished server PID cannot turn the process channels green', (t) => {
  const f = fixture(t);
  const result = spawnSync(
    process.execPath,
    [cli, '--profile', 'mac', '--path', f.path, '--pid', '999999999'],
    {
      encoding: 'utf8',
      env: { HOME: f.dir, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' },
    },
  );
  assert.equal(result.status, 2);
  assert.ok(!result.stdout.includes(marker));
});

test('CLI red and green controls exercise actual OS read permissions with metadata-only output', {
  skip: process.getuid() === 0,
}, (t) => {
  const f = fixture(t);
  const run = () =>
    spawnSync(process.execPath, [cli, '--profile', 'mac', '--path', f.path], {
      encoding: 'utf8',
      env: { HOME: f.dir, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' },
    });
  const red = run();
  assert.equal(red.status, 1);
  assert.equal(red.stderr, '');
  const redRows = red.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(redRows.length, 8);
  assert.equal(redRows.find((row) => row.channel === 'direct').bytes, Buffer.byteLength(marker));
  assert.ok(!red.stdout.includes(marker));
  chmodSync(f.path, 0o000);
  const green = run();
  assert.equal(green.status, 0);
  assert.equal(green.stderr, '');
  const greenRows = green.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(greenRows.length, 8);
  assert.ok(greenRows.every((row) => row.readable === 'no' && row.bytes === 0));
});

test('unexpected filesystem errors report error states in every ordinary read channel and exit two', (t) => {
  const f = fixture(t);
  const loop = join(f.dir, 'loop');
  symlinkSync(loop, loop);
  const result = spawnSync(process.execPath, [cli, '--profile', 'mac', '--path', loop], {
    encoding: 'utf8',
    env: { HOME: f.dir, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(result.status, 2);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  for (const channel of ['direct', 'symlink', 'python', 'node', 'sh', 'subprocess-file']) {
    const row = rows.find((entry) => entry.channel === channel);
    assert.equal(row.readable, 'error', channel);
    assert.equal(row.bytes, 0, channel);
  }
  assert.equal(result.stderr, '');
});

test('a failed shell copy is unavailable rather than a zero-byte success', async (t) => {
  const f = fixture(t);
  const dd = join(f.dir, 'dd');
  writeFileSync(dd, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const rows = [];
  assert.equal(
    await runCanary({
      paths: [f.path],
      procPaths: [],
      scratchParent: f.dir,
      emit: (row) => rows.push(row),
      env: { HOME: f.dir, PATH: `${f.dir}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1' },
    }),
    2,
  );
  assert.equal(rows.find((row) => row.channel === 'sh').readable, 'error');
});
