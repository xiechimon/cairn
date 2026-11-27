#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const GITLEAKS_VERSION = '8.30.1';

const asset = (archive, sha256) => ({
  archive,
  sha256,
  url: `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}`,
});

export const GITLEAKS_ASSETS = {
  'darwin/arm64': asset(
    `gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
    'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  ),
  'darwin/x64': asset(
    `gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
    'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  ),
  'linux/x64': asset(
    `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  ),
  'linux/arm64': asset(
    `gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
    'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  ),
};

const VERSION_PATTERN = new RegExp(
  `(?:^|\\s|v)${GITLEAKS_VERSION.replaceAll('.', '\\.')}(?:\\s|$)`,
);

function defaultSleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

export function selectGitleaksAsset(
  platform = process.platform,
  arch = process.arch,
  assets = GITLEAKS_ASSETS,
) {
  return assets[`${platform}/${arch}`] ?? null;
}

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function installedVersion(binaryPath, spawn = spawnSync) {
  const run = spawn(binaryPath, ['version'], { encoding: 'utf8' });
  if (run.error || run.status !== 0) return null;
  return String(run.stdout ?? '').trim();
}

function matchesExpectedVersion(version) {
  return typeof version === 'string' && VERSION_PATTERN.test(version);
}

export function downloadWithRetry({
  url,
  destPath,
  attempts = 3,
  spawn = spawnSync,
  sleep = defaultSleep,
}) {
  let lastError = 'download failed';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    rmSync(destPath, { force: true });
    const run = spawn(
      'curl',
      ['-fsSL', '--connect-timeout', '15', '--max-time', '60', '-o', destPath, url],
      { encoding: 'utf8' },
    );
    if (!run.error && run.status === 0) return { ok: true };
    lastError =
      run.error?.message ?? (String(run.stderr ?? '').trim() || `curl exited ${run.status}`);
    if (attempt < attempts) sleep(attempt * 5);
  }
  return { ok: false, error: lastError };
}

export function parseInstallArgs(argv) {
  let dest = join(homedir(), '.local', 'bin');
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      force = true;
    } else if (arg === '--dest') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { ok: false, error: 'missing value for --dest' };
      dest = resolve(next);
      i += 1;
    } else {
      return { ok: false, error: `unknown argument: ${arg}` };
    }
  }
  return { ok: true, dest, force };
}

export function installGitleaks({
  dest = join(homedir(), '.local', 'bin'),
  force = false,
  platform = process.platform,
  arch = process.arch,
  assets = GITLEAKS_ASSETS,
  download = downloadWithRetry,
  spawn = spawnSync,
  sleep = defaultSleep,
} = {}) {
  const selected = selectGitleaksAsset(platform, arch, assets);
  if (!selected) {
    return {
      ok: false,
      code: 2,
      error: `unsupported platform ${platform}/${arch}; install gitleaks ${GITLEAKS_VERSION} manually`,
    };
  }
  const target = join(dest, 'gitleaks');
  if (!force && existsSync(target) && matchesExpectedVersion(installedVersion(target, spawn))) {
    return { ok: true, alreadyInstalled: true, target, version: GITLEAKS_VERSION };
  }
  const work = mkdtempSync(join(tmpdir(), 'install-gitleaks-'));
  let staged = null;
  try {
    const archivePath = join(work, selected.archive);
    const fetched = download({ url: selected.url, destPath: archivePath, spawn, sleep });
    if (!fetched.ok) {
      return { ok: false, code: 1, error: `failed to download gitleaks: ${fetched.error}` };
    }
    const actualSha = sha256File(archivePath);
    if (actualSha !== selected.sha256) {
      return {
        ok: false,
        code: 1,
        error: `sha256 mismatch for ${selected.archive}: expected ${selected.sha256}, got ${actualSha}`,
      };
    }
    const extractDir = join(work, 'extract');
    mkdirSync(extractDir, { recursive: true });
    const extractedRun = spawn('tar', ['-xzf', archivePath, '-C', extractDir, 'gitleaks'], {
      encoding: 'utf8',
    });
    if (extractedRun.error || extractedRun.status !== 0) {
      const detail = extractedRun.error?.message ?? String(extractedRun.stderr ?? '').trim();
      return { ok: false, code: 1, error: `failed to extract gitleaks: ${detail}` };
    }
    const extracted = join(extractDir, 'gitleaks');
    const stat = lstatSync(extracted, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      return {
        ok: false,
        code: 1,
        error: 'extracted archive did not contain a regular gitleaks file',
      };
    }
    mkdirSync(dest, { recursive: true });
    staged = join(dest, `.gitleaks.${process.pid}.${randomBytes(4).toString('hex')}`);
    copyFileSync(extracted, staged);
    chmodSync(staged, 0o755);
    const actualVersion = installedVersion(staged, spawn);
    if (!matchesExpectedVersion(actualVersion)) {
      return {
        ok: false,
        code: 1,
        error: `installed binary reported version "${actualVersion ?? 'unknown'}", expected ${GITLEAKS_VERSION}`,
      };
    }
    renameSync(staged, target);
    staged = null;
    return { ok: true, alreadyInstalled: false, target, version: GITLEAKS_VERSION };
  } finally {
    if (staged) rmSync(staged, { force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) {
  const parsed = parseInstallArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[install-gitleaks] ${parsed.error}`);
    process.exitCode = 2;
  } else {
    const result = installGitleaks({ dest: parsed.dest, force: parsed.force });
    if (result.ok) {
      const action = result.alreadyInstalled ? 'already at' : 'installed';
      console.log(`[install-gitleaks] ${action} ${result.version} at ${result.target}`);
    } else {
      console.error(`[install-gitleaks] ${result.error}`);
      process.exitCode = result.code ?? 1;
    }
  }
}
