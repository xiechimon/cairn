import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../test-tmpdir.mjs';

const VERIFY = join(import.meta.dirname, 'host-tools-verify.sh');

function write(path, text, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}

function fixture(files) {
  const dir = makeTestTempDir('host-verify-');
  const checkout = join(dir, 'checkout');
  const env = {
    PATH: '/usr/bin:/bin',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: dir,
  };
  const git = (...args) => execFileSync('git', args, { cwd: checkout, env });
  mkdirSync(checkout, { recursive: true });
  git('init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) write(join(checkout, rel), text, 0o755);
  git('add', ...Object.keys(files));
  git('commit', '-q', '-m', 'seed');
  const roots = {
    CAIRN_CHECKOUT: checkout,
    CAIRN_HOST_TOOLS_ROOT: join(dir, 'tools'),
    CAIRN_HOST_LANES_ROOT: join(dir, 'lanes'),
    CAIRN_HOST_BIN_ROOT: join(dir, 'bin'),
    CAIRN_HOST_UNITS_ROOT: join(dir, 'units'),
  };
  return {
    dir,
    verify: (...args) =>
      spawnSync('bash', [VERIFY, ...args], { env: { ...env, ...roots }, encoding: 'utf8' }),
  };
}

const seed = {
  'scripts/ops/host/tools/a.sh': '#!/bin/bash\necho a\n',
  'scripts/ops/host/bin/cairn-heavy': '#!/bin/bash\necho heavy\n',
  'scripts/ops/host/units/x.timer': '[Timer]\n',
};

test('exits 0 when every managed file matches', () => {
  const f = fixture(seed);
  write(join(f.dir, 'tools/a.sh'), seed['scripts/ops/host/tools/a.sh'], 0o755);
  write(join(f.dir, 'bin/cairn-heavy'), seed['scripts/ops/host/bin/cairn-heavy'], 0o755);
  write(join(f.dir, 'units/x.timer'), seed['scripts/ops/host/units/x.timer']);
  const result = f.verify();
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /DIFF|MISSING|EXTRA/);
});

test('reports DIFF, MISSING and EXTRA and exits 1', () => {
  const f = fixture(seed);
  write(join(f.dir, 'tools/a.sh'), '#!/bin/bash\necho edited\n', 0o755);
  write(join(f.dir, 'tools/stray.sh'), 'x\n');
  write(join(f.dir, 'tools/app-token/package.json'), '{}\n');
  write(join(f.dir, 'tools/old.sh.bak-1'), 'x\n');
  const result = f.verify();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /DIFF +.*tools\/a\.sh/);
  assert.match(result.stdout, /MISSING .*bin\/cairn-heavy/);
  assert.match(result.stdout, /MISSING .*units\/x\.timer/);
  assert.match(result.stdout, /EXTRA +.*tools\/stray\.sh/);
  assert.doesNotMatch(result.stdout, /package\.json|\.bak/);
});

test('--adopt installs the repo copy and keeps the host edit beside it', () => {
  const f = fixture(seed);
  const host = join(f.dir, 'tools/a.sh');
  write(host, '#!/bin/bash\necho edited\n', 0o755);
  const result = f.verify('--adopt', host);
  assert.match(result.stdout, /adopted .*tools\/a\.sh/);
  assert.equal(readFileSync(host, 'utf8'), seed['scripts/ops/host/tools/a.sh']);
  assert.equal(statSync(host).mode & 0o777, 0o755);
  const kept = result.stdout.match(/kept as (\S+)\)/)[1];
  assert.equal(readFileSync(kept, 'utf8'), '#!/bin/bash\necho edited\n');
});

test('--adopt leaves files it was not asked about', () => {
  const f = fixture(seed);
  const host = join(f.dir, 'tools/a.sh');
  write(host, '#!/bin/bash\necho edited\n', 0o755);
  const result = f.verify('--adopt', join(f.dir, 'tools/other.sh'));
  assert.match(result.stdout, /DIFF +.*tools\/a\.sh/);
  assert.equal(readFileSync(host, 'utf8'), '#!/bin/bash\necho edited\n');
});
