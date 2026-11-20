import { createHash } from 'node:crypto';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanupTestTempDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  antigravityKeyFromText,
  createAntigravitySubscriptionSchema,
  DEFAULT_ANTIGRAVITY_MODELS,
} from '../src/index.js';
import {
  unsafeManagedVersion,
  verifiedManagedBin,
  verifiedManagedBins,
} from '../src/node/managed-bin.js';

const tmp = makeTestTempDir('managed-bin-');
afterAll(() => cleanupTestTempDirs());

function seedVersion(root: string, version: string, marker: Record<string, unknown>, bin: string) {
  const dir = join(root, 'versions', version);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'tool'), bin, { mode: 0o755 });
  writeFileSync(join(dir, '.install-complete'), JSON.stringify(marker));
}

describe('antigravity local helpers and schemas', () => {
  test('parses raw token, env export, and JSON credentials while rejecting junk', () => {
    const token = 'AIzaSyA1234567890_ValidTokenValue';
    expect(antigravityKeyFromText(token)).toBe(token);
    expect(antigravityKeyFromText(`export GEMINI_API_KEY="${token}"`)).toBe(token);
    expect(antigravityKeyFromText(`GEMINI_API_KEY='${token}'`)).toBe(token);
    expect(antigravityKeyFromText(JSON.stringify({ GEMINI_API_KEY: token }))).toBe(token);
    expect(antigravityKeyFromText(JSON.stringify({ apiKey: token }))).toBe(token);
    expect(antigravityKeyFromText('')).toBeNull();
    expect(antigravityKeyFromText('short')).toBeNull();
    expect(antigravityKeyFromText('{bad')).toBeNull();
  });

  test('verifiedManagedBin requires the install marker and a matching sha256', () => {
    const root = join(tmp, 'tools', 'demo');
    const bin = 'binary-bytes';
    const sha256 = createHash('sha256').update(bin).digest('hex');
    seedVersion(root, '1.0.0', { binRelPath: 'bin/tool', binSha256: sha256, args: ['acp'] }, bin);
    seedVersion(
      root,
      '2.0.0',
      { binRelPath: 'bin/tool', binSha256: '0'.repeat(64), args: ['acp'] },
      bin,
    );
    mkdirSync(join(root, 'versions', '0.5.0'), { recursive: true });

    expect(verifiedManagedBin(join(root, 'versions', '1.0.0'))).toEqual({
      command: join(root, 'versions', '1.0.0', 'bin', 'tool'),
      args: ['acp'],
    });
    expect(verifiedManagedBin(join(root, 'versions', '2.0.0'))).toBeNull();
    expect(verifiedManagedBin(join(root, 'versions', '0.5.0'))).toBeNull();
    expect(verifiedManagedBins(join(root, 'versions'), ['0.5.0', '2.0.0', '1.0.0'])).toEqual([
      { command: join(root, 'versions', '1.0.0', 'bin', 'tool'), args: ['acp'] },
    ]);
  });

  test('verifiedManagedBin rejects a binary that escapes through a symlinked directory', () => {
    const root = join(tmp, 'tools', 'escape');
    const outside = join(tmp, 'outside');
    mkdirSync(outside, { recursive: true });
    const bin = 'outside-bytes';
    writeFileSync(join(outside, 'tool'), bin);
    const dir = join(root, 'versions', '1.0.0');
    mkdirSync(dir, { recursive: true });
    symlinkSync(outside, join(dir, 'bin'));
    writeFileSync(
      join(dir, '.install-complete'),
      JSON.stringify({
        binRelPath: 'bin/tool',
        binSha256: createHash('sha256').update(bin).digest('hex'),
        args: ['acp'],
      }),
    );
    expect(verifiedManagedBin(dir)).toBeNull();
  });

  test('unsafeManagedVersion marks traversal and hidden versions', () => {
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.hidden']) {
      expect(unsafeManagedVersion(bad), bad).toBe(true);
    }
    for (const good of ['1.0.0', '2024.1-beta', 'x']) {
      expect(unsafeManagedVersion(good), good).toBe(false);
    }
  });

  test('createAntigravitySubscriptionSchema accepts host-login (null/omitted token) and validates token when set', () => {
    expect(createAntigravitySubscriptionSchema.parse({ label: 'Local Keyring' })).toEqual({
      label: 'Local Keyring',
    });
    expect(
      createAntigravitySubscriptionSchema.parse({ label: 'Local Keyring', token: null }),
    ).toEqual({
      label: 'Local Keyring',
      token: null,
    });
    expect(
      createAntigravitySubscriptionSchema.parse({
        label: 'API Key',
        token: 'AIzaSyA1234567890_ValidTokenValue',
      }).token,
    ).toBe('AIzaSyA1234567890_ValidTokenValue');
    expect(() =>
      createAntigravitySubscriptionSchema.parse({ label: 'Bad', token: 'too-short' }),
    ).toThrow();
  });

  test('DEFAULT_ANTIGRAVITY_MODELS includes all 9 observed models', () => {
    expect(DEFAULT_ANTIGRAVITY_MODELS.map((m) => m.id)).toEqual([
      'gemini-4-carbon',
      'gemini-4-argon',
      'gemini-4-hydrogen',
      'gemini-pro-orchestrator',
      'gemini-pro-orchestrator-argon',
      'gemini-3.8-flash',
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'gpt-oss-120b-medium',
    ]);
  });
});
