import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV_VARS } from '@cairn/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';

const supervisor = vi.hoisted(() => ({
  spawnSupervisor: vi.fn(() => ({ pid: 4242 })),
  stopSupervisor: vi.fn(async () => true),
}));

vi.mock('../src/supervisor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/supervisor.js')>()),
  ...supervisor,
}));

const { buildProgram } = await import('../src/cli.js');

describe('cairn restart --server', () => {
  let home = '';

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (home) releaseTestTempDir(home);
  });

  it('restarts the runner against the given server and shows the approval link for that server', async () => {
    home = makeTestTempDir('cli-restart-');
    vi.stubEnv(ENV_VARS.home, home);
    writeFileSync(
      join(home, 'enroll.json'),
      JSON.stringify({
        enrollId: 'e1',
        url: 'http://10.0.0.5:8787/enroll/e1',
        expiresAt: Date.now() + 60_000,
        serverUrl: 'http://10.0.0.5:8787',
      }),
    );
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });

    await buildProgram().parseAsync(['restart', '--server', 'http://10.0.0.5:8787/'], {
      from: 'user',
    });

    expect(supervisor.stopSupervisor).toHaveBeenCalledWith(home);
    expect(supervisor.spawnSupervisor).toHaveBeenCalledWith({
      home,
      runnerArgv: ['start', '--foreground', '--server', 'http://10.0.0.5:8787/'],
    });
    expect(out.join('')).toContain(
      'Approve this machine in a browser: http://10.0.0.5:8787/enroll/e1',
    );
  });
});
