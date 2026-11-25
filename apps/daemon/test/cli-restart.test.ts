import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
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
      `Approve this machine in a browser: http://10.0.0.5:8787/enroll/e1 (machine name: ${hostname()})`,
    );
  });

  it('prints both formatted approval code and authorize URL on start', async () => {
    home = makeTestTempDir('cli-start-code-');
    vi.stubEnv(ENV_VARS.home, home);
    writeFileSync(
      join(home, 'enroll.json'),
      JSON.stringify({
        enrollId: 'e2',
        url: 'http://10.0.0.5:8787/app/machines/authorize?enroll=e2',
        code: 'K7F3Q9XM',
        expiresAt: Date.now() + 60_000,
        serverUrl: 'http://10.0.0.5:8787',
      }),
    );
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });

    await buildProgram().parseAsync(['start', '--server', 'http://10.0.0.5:8787'], {
      from: 'user',
    });

    const text = out.join('');
    expect(text).toContain('Approval code: K7F3-Q9XM');
    expect(text).toContain(
      `Approve this machine in a browser: http://10.0.0.5:8787/app/machines/authorize?enroll=e2 (machine name: ${hostname()})`,
    );
  });

  it('surfaces enrollment connection errors immediately on stderr', async () => {
    home = makeTestTempDir('cli-start-err-');
    vi.stubEnv(ENV_VARS.home, home);
    writeFileSync(
      join(home, 'enroll-error.json'),
      JSON.stringify({
        serverUrl: 'http://10.0.0.5:8787',
        message: 'connect ECONNREFUSED 10.0.0.5:8787',
        at: Date.now() + 5_000,
      }),
    );
    const errOut: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errOut.push(String(chunk));
      return true;
    });
    const prevExit = process.exitCode;
    process.exitCode = undefined;
    try {
      await buildProgram().parseAsync(['start', '--server', 'http://10.0.0.5:8787'], {
        from: 'user',
      });
      expect(errOut.join('')).toContain('connect ECONNREFUSED 10.0.0.5:8787');
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExit;
    }
  });
});
