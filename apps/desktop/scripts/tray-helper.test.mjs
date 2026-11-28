import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nativeTrayMenuSchema } from '@cairn/shared/desktop-shell';
import { skeletonTrayMenu } from '../src/native-tray.ts';
import { compileTrayHelper } from './build-tray-helper.mjs';

const fixture = fileURLToPath(new URL('../native/tray/test/fixture-menu.json', import.meta.url));
const mac = process.platform === 'darwin';

test('keep-awake disclosure exposes current mode and inline children', {
  skip: !mac,
}, async () => {
  const tile = skeletonTrayMenu('zh').items.find((item) => item.id === 'keep-awake');
  assert.equal(tile?.kind, 'disclosure');
  assert.equal(tile.detail, '屏幕可熄灭');
  assert.deepEqual(
    tile.children.map((item) => item.title),
    ['屏幕常亮', '屏幕可熄灭', '合盖继续运行'],
  );
  const fixtureMessage = JSON.parse(readFileSync(fixture, 'utf8'));
  nativeTrayMenuSchema.parse(fixtureMessage.menu);
  const dir = mkdtempSync(join(tmpdir(), 'cairn-tray-test-'));
  try {
    const binary = await compileTrayHelper(join(dir, 'tray-test'), {
      extra: 'test',
      optimize: false,
    });
    const run = spawnSync(binary, [fixture], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /^PASS: \d+ assertions, 0 failures/m);
    for (const locale of ['zh', 'en']) {
      const skeleton = skeletonTrayMenu(locale);
      nativeTrayMenuSchema.parse(skeleton);
      const skeletonPath = join(dir, `skeleton-${locale}.json`);
      writeFileSync(skeletonPath, `${JSON.stringify({ type: 'menu', menu: skeleton })}\n`, 'utf8');
      const decoded = spawnSync(binary, ['--decode-only', skeletonPath], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      assert.equal(decoded.status, 0, `${decoded.stdout}${decoded.stderr}`);
      assert.match(decoded.stdout, /^PASS: decoded \d+ items/m);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the helper builds for both Mac architectures', { skip: !mac }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-tray-arch-'));
  try {
    for (const [arch, expected] of [
      ['arm64', 'arm64'],
      ['x64', 'x86_64'],
    ]) {
      const binary = await compileTrayHelper(join(dir, arch, 'CairnTray'), {
        arch,
        optimize: false,
      });
      assert.match(
        execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim(),
        new RegExp(`^${expected}$`),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
