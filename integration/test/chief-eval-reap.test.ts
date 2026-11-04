import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { reapEscapees } from '../eval/chief-dispatch/stack.mts';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('reapEscapees', () => {
  const homes: string[] = [];
  const pids: number[] = [];

  const makeHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-eval-chief-test-'));
    homes.push(home);
    return home;
  };

  const spawnEscapee = (home: string): number => {
    const webDir = join(home, 'workspaces', 'fake-uuid-0001', 'apps', 'web');
    mkdirSync(webDir, { recursive: true });
    const script = join(webDir, 'fake-dev-server.mjs');
    writeFileSync(script, 'setInterval(() => {}, 1000);\n');
    const child = spawn(process.execPath, [script], {
      cwd: webDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    const pid = child.pid as number;
    pids.push(pid);
    return pid;
  };

  afterEach(() => {
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  test('cleans up dev servers that escaped their workspace', async () => {
    const home = makeHome();
    const pid = spawnEscapee(home);
    await new Promise((r) => setTimeout(r, 400));
    expect(alive(pid)).toBe(true);

    const reaped = await reapEscapees(home);

    expect(reaped).toBeGreaterThanOrEqual(1);
    expect(alive(pid)).toBe(false);
  });

  test('pgrep -f substring matching bridges the /var vs /private/var symlink difference', async () => {
    const home = makeHome();
    const pid = spawnEscapee(home);
    await new Promise((r) => setTimeout(r, 400));

    // tmpdir() yields /var/folders/... while the process cmdline carries
    // /private/var/folders/...; the reverse lookup relies on pgrep -f substring
    // matching, not realpath (realpathSync throws once the directory is gone).
    const out = execFileSync('pgrep', ['-f', home], { encoding: 'utf8' });

    expect(out.split('\n').map((s) => Number(s.trim()))).toContain(pid);
  });

  test('returns 0 when no escaped process exists', async () => {
    expect(await reapEscapees(makeHome())).toBe(0);
  });

  test('returns 0 without throwing when the directory does not exist', async () => {
    expect(await reapEscapees(join(tmpdir(), 'cairn-eval-chief-absent-xyz'))).toBe(0);
  });
});
