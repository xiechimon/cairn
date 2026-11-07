import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createDaemonLogger } from '../src/log.js';

test('daemon file and stdout redact credentials in raw and prefixed messages', () => {
  const home = makeTestTempDir('cairn-log-redaction-');
  const token = 'synthetic-daemon-login-token';
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.stubEnv('CAIRN_TOKEN', token);
  try {
    const logFile = join(home, 'daemon.log');
    const logger = createDaemonLogger({ logFile, stdout: true });
    logger.raw(`failed http://localhost/app#token=${token}`);
    logger.machine(`Authorization: Bearer ${token}`);
    logger.raw(`access denied for ${token}`);
    const outputs = [
      readFileSync(logFile, 'utf8'),
      stdout.mock.calls.map(([line]) => String(line)).join(''),
    ];
    for (const text of outputs) {
      expect(text.includes(token)).toBe(false);
      expect(text.includes('#token=')).toBe(false);
      expect(text).toContain('[REDACTED]');
    }
  } finally {
    stdout.mockRestore();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});
