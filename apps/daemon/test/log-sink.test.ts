import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createDaemonLogger } from '../src/log.js';

test('a log line whose directory disappeared is dropped instead of thrown into the caller', () => {
  const home = makeTestTempDir('cairn-log-vanished-');
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const logger = createDaemonLogger({ logFile: join(home, 'state', 'daemon.log'), stdout: true });
    rmSync(join(home, 'state'), { recursive: true, force: true });
    expect(() => logger.machine('the log directory is gone')).not.toThrow();
    expect(stdout.mock.calls.length).toBeGreaterThan(0);
  } finally {
    stdout.mockRestore();
    rmSync(home, { recursive: true, force: true });
  }
});
