import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileTrayHelper } from './build-tray-helper.mjs';

const fixture = fileURLToPath(new URL('../native/tray/test/fixture-menu.json', import.meta.url));
const mac = process.platform === 'darwin';

test('the native menu built from a page snapshot reads, focuses and updates right', {
  skip: !mac,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-tray-test-'));
  try {
    const binary = compileTrayHelper(join(dir, 'tray-test'), { extra: 'test', optimize: false });
    const run = spawnSync(binary, [fixture], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /^PASS: \d+ assertions, 0 failures/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the helper builds for both Mac architectures', { skip: !mac }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-tray-arch-'));
  try {
    for (const [arch, expected] of [
      ['arm64', 'arm64'],
      ['x64', 'x86_64'],
    ]) {
      const binary = compileTrayHelper(join(dir, arch, 'CairnTray'), { arch, optimize: false });
      assert.match(
        execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim(),
        new RegExp(`^${expected}$`),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
