import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  applyStagedUpdate,
  failedAppPath,
  previousAppPath,
  readBundleVersion,
  restoreIfBundleMissing,
  restorePrevious,
} from '../src/update-swap.ts';

function bundle(root, version) {
  const app = join(root, 'Cairn.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  const executable = join(app, 'Contents', 'MacOS', 'Cairn');
  writeFileSync(executable, `#!/bin/sh\necho ${version}\n`);
  chmodSync(executable, 0o755);
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`,
  );
  return app;
}

function install() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-update-swap-'));
  const applications = join(root, 'Applications');
  const staging = join(root, 'staging');
  mkdirSync(applications, { recursive: true });
  mkdirSync(staging, { recursive: true });
  const running = bundle(applications, '0.1.535');
  return {
    root,
    applications,
    bundle: running,
    stagedApp: bundle(staging, '0.1.536'),
    previousApp: previousAppPath(running),
  };
}

test('the running bundle becomes the previous version and the staged one takes its place', async () => {
  const ctx = install();
  await applyStagedUpdate(ctx);
  assert.equal(await readBundleVersion(ctx.bundle), '0.1.536');
  assert.equal(await readBundleVersion(ctx.previousApp), '0.1.535');
  assert.equal(existsSync(ctx.stagedApp), false, 'the staged copy moved out of staging');
});

test('a failed second rename puts the running bundle straight back', async () => {
  const ctx = install();
  const broken = { ...ctx, stagedApp: join(ctx.root, 'staging', 'missing', 'Cairn.app') };
  await assert.rejects(applyStagedUpdate(broken));
  assert.equal(await readBundleVersion(ctx.bundle), '0.1.535');
  assert.equal(existsSync(ctx.previousApp), false);
});

test('rollback moves the failed bundle aside and puts the previous version back', async () => {
  const ctx = install();
  await applyStagedUpdate(ctx);
  const failed = await restorePrevious(ctx);
  assert.equal(failed, failedAppPath(ctx.bundle));
  assert.equal(await readBundleVersion(ctx.bundle), '0.1.535');
  assert.equal(await readBundleVersion(failed), '0.1.536');
});

test('a rollback whose previous version is gone leaves the running bundle alone', async () => {
  const ctx = install();
  await applyStagedUpdate(ctx);
  rmSync(ctx.previousApp, { recursive: true, force: true });
  await assert.rejects(restorePrevious(ctx));
  assert.equal(await readBundleVersion(ctx.bundle), '0.1.536');
});

test('a second apply that did not clear the kept copy refuses instead of losing it', async () => {
  const ctx = install();
  await applyStagedUpdate(ctx);
  const second = bundle(join(ctx.root, 'staging2'), '0.1.537');
  await assert.rejects(applyStagedUpdate({ ...ctx, stagedApp: second }));
  assert.equal(await readBundleVersion(ctx.bundle), '0.1.536');
  assert.equal(await readBundleVersion(ctx.previousApp), '0.1.535');
});

test('a launch that finds no bundle puts the previous version back', async () => {
  const ctx = install();
  await applyStagedUpdate(ctx);
  rmSync(ctx.bundle, { recursive: true, force: true });
  assert.equal(await restoreIfBundleMissing(ctx.bundle), true);
  assert.equal(await readBundleVersion(ctx.bundle), '0.1.535');
});

test('a launch with a bundle in place leaves the kept copy alone', async () => {
  const ctx = install();
  await applyStagedUpdate(ctx);
  assert.equal(await restoreIfBundleMissing(ctx.bundle), false);
  assert.equal(
    await readBundleVersion(join(ctx.applications, '.cairn-previous', 'Cairn.app')),
    '0.1.535',
  );
});

test('a launch with neither a bundle nor a kept copy stays put', async () => {
  const ctx = install();
  rmSync(ctx.bundle, { recursive: true, force: true });
  assert.equal(await restoreIfBundleMissing(ctx.bundle), false);
});

test('a bundle without a version is reported as such, never guessed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-update-plain-'));
  assert.equal(await readBundleVersion(join(dir, 'Cairn.app')), null);
  mkdirSync(join(dir, 'Cairn.app'), { recursive: true });
  assert.equal(await readBundleVersion(join(dir, 'Cairn.app')), null);
});
