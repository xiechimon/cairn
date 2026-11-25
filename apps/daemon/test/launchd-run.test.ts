import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { testTempDir } from './test-temp-dir.js';

const SCRIPT = join(import.meta.dirname, '..', 'launchd', 'cairn-daemon-run.sh');
const sleepers: number[] = [];

afterEach(() => {
  for (const pid of sleepers.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
});

function renderedLauncher(home: string): string {
  const path = join(home, 'run.sh');
  writeFileSync(
    path,
    readFileSync(SCRIPT, 'utf8')
      .replaceAll('@CAIRN_REPO@', join(home, 'checkout'))
      .replaceAll('@NODE_BIN@', process.execPath),
    { mode: 0o755 },
  );
  return path;
}

function previousDaemon(home: string, seconds: number): void {
  const started = spawnSync('/bin/sh', ['-c', `sleep ${seconds} >/dev/null 2>&1 & echo $!`], {
    encoding: 'utf8',
  });
  const pid = Number.parseInt(started.stdout.trim(), 10);
  sleepers.push(pid);
  writeFileSync(join(home, 'daemon.json'), JSON.stringify({ pid }));
}

function launch(home: string) {
  return spawnSync('/bin/sh', [renderedLauncher(home)], {
    env: { ...process.env, CAIRN_HOME: home, CAIRN_RUN_TWIN_WAIT_S: '4' },
    encoding: 'utf8',
  });
}

describe('launchd launcher during a restart', () => {
  test('waits for the previous daemon that is still shutting down, then starts', () => {
    const home = testTempDir('cairn-launchd-run-');
    previousDaemon(home, 1);
    const run = launch(home);
    expect(run.stdout).not.toContain('already running');
    expect(run.stderr).toContain('checkout missing');
    expect(run.status).not.toBe(0);
  });

  test('a daemon that keeps running exits non-zero so launchd tries again', () => {
    const home = testTempDir('cairn-launchd-run-');
    previousDaemon(home, 60);
    const run = launch(home);
    expect(run.stdout).toContain('still running');
    expect(run.status).not.toBe(0);
  });
});
