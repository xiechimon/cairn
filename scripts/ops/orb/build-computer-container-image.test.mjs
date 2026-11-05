import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const script = join(import.meta.dirname, 'build-computer-container-image.sh');

function fixture(t) {
  const allocated = makeTestTempDir('cbi-');
  t.after(() => assert.equal(releaseTestTempDir(allocated), true));
  const root = realpathSync(allocated);
  const bin = join(root, 'bin');
  const context = join(root, 'context');
  mkdirSync(bin);
  mkdirSync(context);
  for (const filename of ['Dockerfile', 'entry.sh', 'desktop.sh', 'chromium-policy.json'])
    writeFileSync(join(context, filename), `fixture ${filename}\n`);
  const calls = join(root, 'calls');
  const podman = join(bin, 'podman');
  writeFileSync(
    podman,
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'info') { console.log(process.env.FAKE_ROOTLESS ?? 'true'); process.exit(0); }
if (args[0] === 'image' && args[1] === 'inspect') {
  if (process.env.FAKE_BASE_MISSING) process.exit(125);
  console.log(process.env.FAKE_BASE_ID ?? 'a'.repeat(64)); process.exit(0);
}
if (args[0] === 'image' && args[1] === 'exists') process.exit(process.env.FAKE_OUTPUT_EXISTS === '1' ? 0 : 1);
if (args[0] === 'build') { console.log('BUILD PROGRESS'); process.exit(Number(process.env.FAKE_BUILD_EXIT ?? 0)); }
process.exit(99);
`,
  );
  chmodSync(podman, 0o755);
  for (const command of ['claude', 'codex', 'npm', 'pnpm', 'sudo']) {
    const filename = join(bin, command);
    writeFileSync(
      filename,
      '#!/bin/sh\nprintf "Unexpected host tool invocation\\n" >&2\nexit 99\n',
    );
    chmodSync(filename, 0o755);
  }
  const run = (extra = {}) =>
    spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CAIRN_COMPUTER_BASE_IMAGE: 'localhost/cairn-orb-base:0123456789abcdef',
        CAIRN_COMPUTER_IMAGE_CONTEXT: context,
        FAKE_CALLS: calls,
        ...extra,
      },
    });
  const recorded = () =>
    existsSync(calls)
      ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
  return { run, recorded, context };
}

test('requires an explicit pinned base and never probes host model CLIs or package managers', (t) => {
  const f = fixture(t);
  for (const value of ['', 'cairn-orb-base:latest', 'untrusted/base:0123456789abcdef']) {
    const result = f.run({ CAIRN_COMPUTER_BASE_IMAGE: value });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /CAIRN_COMPUTER_BASE_IMAGE/);
  }
  assert.deepEqual(f.recorded(), []);
});

test('missing or nonrootless bases fail before any build', (t) => {
  const f = fixture(t);
  for (const extra of [{ FAKE_BASE_MISSING: '1' }, { FAKE_ROOTLESS: 'false' }]) {
    const result = f.run(extra);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /base image|rootless runtime/);
  }
  assert.equal(
    f.recorded().some((args) => args[0] === 'build'),
    false,
  );
});

test('builds from the inspected immutable local base ID with pulls and ambient proxy disabled', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^cairn-orb-computer:[a-f0-9]{16}\n$/);
  const build = f.recorded().find((args) => args[0] === 'build');
  assert.ok(build);
  assert.ok(build.includes(`COMPUTER_BASE_IMAGE=${'a'.repeat(64)}`));
  assert.ok(build.includes('--pull=never'));
  assert.ok(build.includes('--http-proxy=false'));
  assert.equal(build.at(-1), f.context);
  assert.equal(build.includes('--privileged'), false);
  assert.match(result.stderr, /BUILD PROGRESS/);
});

test('recipe identity follows immutable base content and desktop configuration', (t) => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(f.run().stdout, first.stdout);
  assert.notEqual(f.run({ FAKE_BASE_ID: 'b'.repeat(64) }).stdout, first.stdout);
  writeFileSync(join(f.context, 'desktop.sh'), 'updated desktop\n');
  assert.notEqual(f.run().stdout, first.stdout);
});

test('an existing computed image skips build and a failing build prints no successful tag', (t) => {
  const f = fixture(t);
  const existing = f.run({ FAKE_OUTPUT_EXISTS: '1' });
  assert.equal(existing.status, 0, existing.stderr);
  assert.equal(
    f.recorded().some((args) => args[0] === 'build'),
    false,
  );
  const failed = f.run({ FAKE_BUILD_EXIT: '7' });
  assert.equal(failed.status, 7);
  assert.equal(failed.stdout, '');
});
