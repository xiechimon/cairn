import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  collectSanitizedDiagnostics,
  sanitizeFeedbackText,
  submitFeedbackReport,
} from '../src/services/feedback.js';

const dirs: string[] = [];

function makeDir(): string {
  const dir = makeTestTempDir('cairn-fb-');
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    releaseTestTempDir(dir);
  }
});

describe('sanitized feedback submission', () => {
  test('redacts secrets, session/device tokens, extra secrets, and local usernames', () => {
    const home = makeDir();
    mkdirSync(join(home, 'logs'), { recursive: true });
    writeFileSync(
      join(home, 'logs', 'server.log'),
      'Error at /Users/ian/Code/cairn using token sk-ant-api03-1234567890abcdef1234567890abcdef cairn_dev_secret42 cairn_session=sess123 ownerTokenXYZ\n',
    );
    const outside = join(home, 'secret.txt');
    writeFileSync(outside, 'TOP_SECRET_OUTSIDE_FILE');
    symlinkSync(outside, join(home, 'logs', 'linked.log'));

    const diag = collectSanitizedDiagnostics({
      homeDir: home,
      dataDir: home,
      extraSecrets: ['ownerTokenXYZ'],
    });
    expect(diag).toContain('server.log');
    expect(diag).toContain('/Users/~/Code/cairn');
    expect(diag).not.toContain('/Users/ian/');
    expect(diag).not.toContain('sk-ant-api03-1234567890');
    expect(diag).not.toContain('cairn_dev_secret42');
    expect(diag).not.toContain('sess123');
    expect(diag).not.toContain('ownerTokenXYZ');
    expect(diag).not.toContain('TOP_SECRET_OUTSIDE_FILE');
    expect(sanitizeFeedbackText('/home/alice/app?token=abc123&pair=ZXCV')).toBe(
      '/home/~/app?[REDACTED]&pair=[REDACTED]',
    );
  });

  test('forwards sanitized payload to relay endpoint and validates https issueUrl', async () => {
    const home = makeDir();
    let capturedBody = '';
    const result = await submitFeedbackReport({
      body: {
        message: 'Bug in /Users/ian/app',
        route: '/app?token=leakme999',
        includeLogs: true,
      },
      homeDir: home,
      dataDir: home,
      endpoint: 'https://feedback.example.test/submit',
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            ok: true,
            id: '#9999',
            issueUrl: 'https://github.com/xiechimon/cairn/issues/9999',
          }),
          { status: 201 },
        );
      },
    });
    expect(result).toEqual({
      ok: true,
      id: '#9999',
      issueUrl: 'https://github.com/xiechimon/cairn/issues/9999',
    });
    expect(capturedBody).toContain('/Users/~/app');
    expect(capturedBody).not.toContain('/Users/ian');
    expect(capturedBody).not.toContain('leakme999');

    const badUrlResult = await submitFeedbackReport({
      body: { message: 'Test', includeLogs: false },
      homeDir: home,
      dataDir: home,
      endpoint: 'https://feedback.example.test/submit',
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, id: '#1000', issueUrl: 'javascript:alert(1)' }), {
          status: 201,
        }),
    });
    expect(badUrlResult).toEqual({ ok: true, id: '#1000' });
  });
});
