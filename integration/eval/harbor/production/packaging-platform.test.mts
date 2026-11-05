import { execFile } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { packagingTestsRequested, requirePackagingPlatform } from './packaging-platform.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) releaseTestTempDir(root);
});

test.each([undefined, '', '0', 'true'])(
  'ordinary host setting %j does not claim packaging proof',
  (setting) => {
    expect(packagingTestsRequested(setting)).toBe(false);
  },
);

test('dedicated packaging execution is explicit', () => {
  expect(packagingTestsRequested('1')).toBe(true);
});

test('requested packaging proof refuses unsupported hosts', async () => {
  await expect(requirePackagingPlatform({ platform: 'darwin' })).rejects.toThrow(/requires Linux/);
});

test('requested packaging proof fails when Bubblewrap is absent', async () => {
  await expect(
    requirePackagingPlatform({ platform: 'linux', bwrapPath: '/no-such-bubblewrap' }),
  ).rejects.toThrow(/Bubblewrap namespace preflight failed/);
});

test('requested packaging proof fails when kernel namespace creation is denied', async () => {
  const root = makeTestTempDir('packaging-platform-');
  roots.push(root);
  const binary = join(root, 'bwrap');
  writeFileSync(binary, '#!/bin/sh\nexit 23\n');
  chmodSync(binary, 0o700);
  await expect(requirePackagingPlatform({ platform: 'linux', bwrapPath: binary })).rejects.toThrow(
    /Bubblewrap namespace preflight failed/,
  );
});

test('preflight CLI refuses a packaging job without explicit test opt-in', async () => {
  const loader = createRequire(import.meta.url).resolve('tsx/cli');
  await expect(
    promisify(execFile)(
      process.execPath,
      [loader, join(import.meta.dirname, 'packaging-preflight.mts')],
      { env: { ...process.env, CAIRN_EVAL_PACKAGING_TESTS: '0' }, timeout: 10_000 },
    ),
  ).rejects.toThrow(/CAIRN_EVAL_PACKAGING_TESTS=1 is required/);
});
