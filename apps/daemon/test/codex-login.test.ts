import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { readCodexLogin } from '../src/backend/codex-login.js';

test.each([
  { value: { type: 'other' }, expected: { state: 'unknown' } },
  { value: { type: 'api_key', key: 'secret' }, expected: { state: 'absent' } },
  {
    value: { type: 'oauth', access: 'a', refresh: 'r', expires: 2000 },
    expected: { state: 'ok', expiresAt: 2000 },
  },
  {
    value: { type: 'oauth', access: 'a', refresh: 'r', expires: 1000 },
    expected: { state: 'expired', expiresAt: 1000 },
  },
  {
    value: { type: 'oauth', access: '', refresh: 'r', expires: 2000 },
    expected: { state: 'unknown' },
  },
  { value: { type: 'oauth', access: 'a', refresh: 'r' }, expected: { state: 'unknown' } },
])('Codex credential metadata: $expected', ({ value, expected }) => {
  const dir = makeTestTempDir('codex-login-');
  onTestFinished(() => {
    releaseTestTempDir(dir);
  });
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ 'openai-codex': value }));
  expect(readCodexLogin(dir, 1000)).toEqual(expected);
});

test('missing and malformed auth files fail closed without credential text', () => {
  const dir = makeTestTempDir('codex-login-');
  onTestFinished(() => {
    releaseTestTempDir(dir);
  });
  expect(readCodexLogin(dir)).toEqual({ state: 'absent' });
  writeFileSync(join(dir, 'auth.json'), 'private-malformed-json');
  expect(readCodexLogin(dir)).toEqual({ state: 'unknown' });
});
