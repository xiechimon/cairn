import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import {
  downloadWithRetry,
  GITLEAKS_ASSETS,
  GITLEAKS_VERSION,
  installGitleaks,
  selectGitleaksAsset,
  sha256File,
} from './install-gitleaks.mjs';

const SCRIPT = join(import.meta.dirname, 'install-gitleaks.mjs');

function makeTarball(t, archiveName, buildPayload) {
  const root = makeTestTempDir('install-gitleaks-');
  t.after(() => releaseTestTempDir(root));
  const payload = join(root, 'payload');
  const dest = join(root, 'dest');
  mkdirSync(payload, { recursive: true });
  mkdirSync(dest, { recursive: true });
  buildPayload(payload, root);
  const archive = join(root, archiveName);
  execFileSync('tar', ['-czf', archive, '-C', payload, 'gitleaks']);
  return { root, dest, archive, sha256: sha256File(archive) };
}

test('selectGitleaksAsset maps supported platforms with sha256 digests and rejects others', () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'x64'],
    ['linux', 'arm64'],
  ]) {
    const selected = selectGitleaksAsset(platform, arch);
    assert.ok(selected, `${platform}/${arch}`);
    assert.match(selected.sha256, /^[0-9a-f]{64}$/);
    assert.ok(selected.url.includes(`/v${GITLEAKS_VERSION}/${selected.archive}`));
  }
  assert.equal(selectGitleaksAsset('win32', 'x64'), null);
  assert.equal(Object.keys(GITLEAKS_ASSETS).length, 4);
});

test('installGitleaks verifies sha256, installs atomically, and skips reinstall when already present', (t) => {
  const { dest, archive, sha256 } = makeTarball(t, 'gitleaks.tar.gz', (payload) => {
    writeFileSync(join(payload, 'gitleaks'), `#!/bin/sh\necho "${GITLEAKS_VERSION}"\n`);
    chmodSync(join(payload, 'gitleaks'), 0o755);
  });
  let downloads = 0;
  const assets = {
    'linux/x64': { archive: 'gitleaks.tar.gz', sha256, url: 'https://example.invalid/gl.tar.gz' },
  };
  const first = installGitleaks({
    dest,
    platform: 'linux',
    arch: 'x64',
    assets,
    download: ({ destPath }) => {
      downloads += 1;
      copyFileSync(archive, destPath);
      return { ok: true };
    },
  });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.alreadyInstalled, false);
  assert.equal(downloads, 1);
  assert.equal(
    execFileSync(join(dest, 'gitleaks'), ['version'], { encoding: 'utf8' }).trim(),
    GITLEAKS_VERSION,
  );

  const second = installGitleaks({
    dest,
    platform: 'linux',
    arch: 'x64',
    assets,
    download: () => assert.fail('must not re-download when expected version is present'),
  });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyInstalled, true);
  assert.equal(downloads, 1);
});

test('installGitleaks refuses sha256 mismatch without creating or overwriting the target', (t) => {
  const { dest, archive } = makeTarball(t, 'gitleaks.tar.gz', (payload) => {
    writeFileSync(join(payload, 'gitleaks'), `#!/bin/sh\necho "${GITLEAKS_VERSION}"\n`);
    chmodSync(join(payload, 'gitleaks'), 0o755);
  });
  const target = join(dest, 'gitleaks');
  writeFileSync(target, 'existing-sentinel\n');
  const result = installGitleaks({
    dest,
    force: true,
    platform: 'linux',
    arch: 'x64',
    assets: {
      'linux/x64': {
        archive: 'gitleaks.tar.gz',
        sha256: '0'.repeat(64),
        url: 'https://example.invalid/gl.tar.gz',
      },
    },
    download: ({ destPath }) => {
      copyFileSync(archive, destPath);
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /sha256 mismatch/);
  assert.equal(readFileSync(target, 'utf8'), 'existing-sentinel\n');
});

test('installGitleaks refuses symlinks and wrong-version binaries without overwriting', (t) => {
  const sym = makeTarball(t, 'symlink.tar.gz', (payload, root) => {
    writeFileSync(join(root, 'real'), '#!/bin/sh\necho "8.30.1"\n');
    symlinkSync(join(root, 'real'), join(payload, 'gitleaks'));
  });
  const symResult = installGitleaks({
    dest: sym.dest,
    platform: 'linux',
    arch: 'x64',
    assets: {
      'linux/x64': {
        archive: 'symlink.tar.gz',
        sha256: sym.sha256,
        url: 'https://example.invalid/sym.tar.gz',
      },
    },
    download: ({ destPath }) => {
      copyFileSync(sym.archive, destPath);
      return { ok: true };
    },
  });
  assert.equal(symResult.ok, false);
  assert.match(symResult.error, /regular gitleaks file/);
  assert.equal(existsSync(join(sym.dest, 'gitleaks')), false);

  const wrong = makeTarball(t, 'wrong-ver.tar.gz', (payload) => {
    writeFileSync(join(payload, 'gitleaks'), '#!/bin/sh\necho "0.0.0"\n');
    chmodSync(join(payload, 'gitleaks'), 0o755);
  });
  const wrongResult = installGitleaks({
    dest: wrong.dest,
    platform: 'linux',
    arch: 'x64',
    assets: {
      'linux/x64': {
        archive: 'wrong-ver.tar.gz',
        sha256: wrong.sha256,
        url: 'https://example.invalid/wrong.tar.gz',
      },
    },
    download: ({ destPath }) => {
      copyFileSync(wrong.archive, destPath);
      return { ok: true };
    },
  });
  assert.equal(wrongResult.ok, false);
  assert.match(wrongResult.error, /expected 8\.30\.1/);
  assert.equal(existsSync(join(wrong.dest, 'gitleaks')), false);
});

test('downloadWithRetry retries transient failures and fails after exhausting attempts', (t) => {
  const root = makeTestTempDir('install-gitleaks-retry-');
  t.after(() => releaseTestTempDir(root));
  const destPath = join(root, 'gl.tar.gz');
  const sleeps = [];
  let calls = 0;
  const recovered = downloadWithRetry({
    url: 'https://example.invalid/gl.tar.gz',
    destPath,
    sleep: (seconds) => sleeps.push(seconds),
    spawn: () => {
      calls += 1;
      return calls < 3 ? { status: 28, stderr: 'timed out' } : { status: 0 };
    },
  });
  assert.equal(recovered.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [5, 10]);

  const exhausted = downloadWithRetry({
    url: 'https://example.invalid/gl.tar.gz',
    destPath,
    sleep: () => {},
    spawn: () => ({ status: 22, stderr: 'HTTP 502' }),
  });
  assert.equal(exhausted.ok, false);
  assert.match(exhausted.error, /HTTP 502/);
});

test('install-gitleaks CLI rejects unknown flags and missing --dest values', () => {
  for (const args of [['--wat'], ['--dest'], ['--dest', '--force']]) {
    const run = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 2, args.join(' '));
  }
});
