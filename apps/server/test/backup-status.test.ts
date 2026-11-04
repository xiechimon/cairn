import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { backupNotice } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { backupStatusPathOf } from '../src/config.js';
import { readBackupHealth } from '../src/services/backup-status.js';
import { bootServer } from './helpers.js';

const WRITER = resolve(import.meta.dirname, '../../../scripts/ops/record-backup-status.sh');

function withTempDir(run: (dir: string) => void): void {
  const dir = makeTestTempDir('backup-status-');
  try {
    run(dir);
  } finally {
    releaseTestTempDir(dir);
  }
}

function recordRun(statusPath: string, env: Record<string, string>) {
  const { SERVICE_RESULT: _result, EXIT_CODE: _code, EXIT_STATUS: _status, ...base } = process.env;
  return spawnSync('bash', [WRITER, '--status', statusPath], {
    env: { ...base, ...env },
    encoding: 'utf8',
  });
}

describe('backup status path', () => {
  test('lives next to server.db in the data dir', () => {
    expect(backupStatusPathOf({ dbPath: '/srv/cairn/server/server.db' })).toBe(
      '/srv/cairn/server/backup-status.json',
    );
  });
});

describe('readBackupHealth', () => {
  test('a missing file is none and a malformed or foreign file is unreadable', () => {
    withTempDir((dir) => {
      const path = join(dir, 'backup-status.json');
      expect(readBackupHealth(path)).toEqual({ state: 'none' });
      writeFileSync(path, '{"host":');
      expect(readBackupHealth(path)).toEqual({ state: 'unreadable' });
      writeFileSync(path, JSON.stringify({ host: 'omarchy', lastRunAt: 'yesterday' }));
      expect(readBackupHealth(path)).toEqual({ state: 'unreadable' });
      expect(readBackupHealth(dir)).toEqual({ state: 'unreadable' });
    });
  });
});

describe('record-backup-status.sh', () => {
  test('records a success, then a failure that keeps the last success time', () => {
    withTempDir((dir) => {
      const path = join(dir, 'backup-status.json');
      const ok = recordRun(path, {
        SERVICE_RESULT: 'success',
        EXIT_CODE: 'exited',
        EXIT_STATUS: '0',
      });
      expect(ok.status, ok.stderr).toBe(0);
      const first = readBackupHealth(path);
      expect(first.state).toBe('recorded');
      if (first.state !== 'recorded') return;
      expect(first.status.lastRunResult).toBe('success');
      expect(first.status.lastSuccessAt).toBe(first.status.lastRunAt);
      expect(Math.abs(first.status.lastRunAt - Date.now())).toBeLessThan(60_000);
      expect(first.status.host).not.toBe('');
      expect(backupNotice(first, Date.now())).toBeNull();
      expect(statSync(path).mode & 0o077).toBe(0);

      const failed = recordRun(path, {
        SERVICE_RESULT: 'exit-code',
        EXIT_CODE: 'exited',
        EXIT_STATUS: '255',
      });
      expect(failed.status, failed.stderr).toBe(0);
      const second = readBackupHealth(path);
      expect(second.state).toBe('recorded');
      if (second.state !== 'recorded') return;
      expect(second.status.lastRunResult).toBe('exit-code');
      expect(second.status.lastRunExitStatus).toBe('255');
      expect(second.status.lastSuccessAt).toBe(first.status.lastSuccessAt);
      expect(backupNotice(second, Date.now())).toEqual({
        kind: 'failing',
        host: first.status.host,
        detail: 'exit-code 255',
        hours: 0,
      });
    });
  });

  test('a first run that fails records no success time', () => {
    withTempDir((dir) => {
      const path = join(dir, 'backup-status.json');
      const run = recordRun(path, {
        SERVICE_RESULT: 'timeout',
        EXIT_CODE: 'killed',
        EXIT_STATUS: 'TERM',
      });
      expect(run.status, run.stderr).toBe(0);
      const health = readBackupHealth(path);
      expect(health.state === 'recorded' && health.status.lastSuccessAt).toBeNull();
      expect(backupNotice(health, Date.now())).toMatchObject({
        kind: 'failing',
        detail: 'timeout TERM',
      });
    });
  });

  test('refuses to run outside systemd and leaves no status behind', () => {
    withTempDir((dir) => {
      const path = join(dir, 'backup-status.json');
      const run = recordRun(path, {});
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('SERVICE_RESULT');
      expect(readBackupHealth(path)).toEqual({ state: 'none' });
    });
  });

  test('a status carrying a quote or backslash in the host still parses', () => {
    withTempDir((dir) => {
      const path = join(dir, 'backup-status.json');
      const run = recordRun(path, {
        SERVICE_RESULT: 'exit-code',
        EXIT_STATUS: '1"\\x',
        BACKUP_STATUS_HOST: 'om"ar\\chy',
      });
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
        host: 'om"ar\\chy',
        lastRunExitStatus: '1"\\x',
      });
    });
  });
});

describe('GET /api/server/backup', () => {
  test('serves the health of the configured status file', async () => {
    const dir = makeTestTempDir('backup-route-');
    try {
      const path = join(dir, 'backup-status.json');
      const s = bootServer({ backupStatusPath: path });
      const none = await s.app.request('/api/server/backup');
      expect(none.status).toBe(200);
      expect(await none.json()).toEqual({ state: 'none' });
      writeFileSync(
        path,
        JSON.stringify({
          host: 'omarchy',
          lastRunAt: 1,
          lastRunResult: 'exit-code',
          lastRunExitStatus: '1',
          lastSuccessAt: null,
        }),
      );
      const recorded = await s.app.request('/api/server/backup');
      expect(await recorded.json()).toEqual({
        state: 'recorded',
        status: {
          host: 'omarchy',
          lastRunAt: 1,
          lastRunResult: 'exit-code',
          lastRunExitStatus: '1',
          lastSuccessAt: null,
        },
      });
    } finally {
      releaseTestTempDir(dir);
    }
  });

  test('a server without a status path reports none', async () => {
    const s = bootServer();
    const res = await s.app.request('/api/server/backup');
    expect(await res.json()).toEqual({ state: 'none' });
  });
});
