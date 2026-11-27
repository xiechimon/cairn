import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_UPDATE_STATUS_FILE, type HostUpdateStatus } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openMemoryDb } from '../src/db/client.js';
import { createReleaseWatcher } from '../src/services/release-watcher.js';

const cleanupDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writePlist(homeDir: string): string {
  const plistPath = join(homeDir, 'app.cairn.updater.plist');
  writeFileSync(plistPath, '<plist/>');
  chmodSync(plistPath, 0o600);
  return plistPath;
}

function writeStatus(homeDir: string, status: HostUpdateStatus): void {
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(homeDir, HOST_UPDATE_STATUS_FILE), `${JSON.stringify(status)}\n`, {
    mode: 0o600,
  });
}

describe('createReleaseWatcher', () => {
  test('auto-triggers resident host update once when a newer release appears and skips unsupported or rolled-back versions', async () => {
    const homeDir = makeTestTempDir('cairn-watcher-');
    cleanupDirs.push(homeDir);
    const plistPath = writePlist(homeDir);
    vi.stubEnv('CAIRN_MANAGED_BY', 'launchd');
    vi.stubEnv('CAIRN_UPDATER_PLIST', plistPath);
    vi.stubEnv('CAIRN_SERVER_VERSION', '0.1.720');

    const db = openMemoryDb();
    const triggers: Array<{ id: string; requestedVersion: string | null; force?: boolean }> = [];
    let manifestVersion = '0.1.725';

    const watcher = createReleaseWatcher({
      db,
      homeDir,
      hostUpdate: {
        trigger: async (request) => {
          triggers.push({
            id: request.id,
            requestedVersion: request.requestedVersion,
            force: request.force,
          });
        },
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            version: manifestVersion,
            files: {
              arm64: {
                name: `Cairn-${manifestVersion}-mac-arm64.zip`,
                size: 100,
                sha256: 'a'.repeat(64),
              },
            },
          }),
          { status: 200 },
        ),
    });

    expect(await watcher.checkNow()).toBe('0.1.725');
    expect(watcher.latestRelease()).toBe('0.1.725');
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ requestedVersion: '0.1.725' });
    expect(triggers[0]?.force).not.toBe(true);

    writeStatus(homeDir, {
      pid: process.pid,
      kind: 'background-agent',
      supported: true,
      blocker: null,
      state: 'idle',
      targetVersion: null,
      percent: null,
      reason: 'blocked',
      handledRequestId: triggers[0]?.id ?? null,
      updatedAt: Date.now(),
      rollback: {
        failedVersion: '0.1.725',
        restoredVersion: '0.1.720',
        reason: 'health check failed',
        at: Date.now(),
      },
    });

    expect(await watcher.checkNow()).toBe('0.1.725');
    expect(triggers).toHaveLength(1);

    manifestVersion = '0.1.726';
    expect(await watcher.checkNow()).toBe('0.1.726');
    expect(triggers).toHaveLength(2);
    expect(triggers[1]?.requestedVersion).toBe('0.1.726');
    watcher.stop();
  });

  test('does not trigger update when updater is unsupported and handles offline manifest cleanly', async () => {
    const homeDir = makeTestTempDir('cairn-watcher-unsup-');
    cleanupDirs.push(homeDir);
    vi.stubEnv('CAIRN_SERVER_VERSION', '0.1.720');

    const db = openMemoryDb();
    const triggers: string[] = [];
    let offline = false;

    const watcher = createReleaseWatcher({
      db,
      homeDir,
      hostUpdate: {
        trigger: async (request) => {
          triggers.push(request.id);
        },
      },
      fetchImpl: async () => {
        if (offline) throw new Error('network unreachable');
        return new Response(
          JSON.stringify({
            version: '0.1.725',
            files: {
              arm64: { name: 'Cairn-0.1.725-mac-arm64.zip', size: 100, sha256: 'a'.repeat(64) },
            },
          }),
          { status: 200 },
        );
      },
    });

    expect(await watcher.checkNow()).toBe('0.1.725');
    expect(watcher.latestRelease()).toBe('0.1.725');
    expect(triggers).toHaveLength(0);

    offline = true;
    expect(await watcher.checkNow()).toBe('0.1.725');
    expect(triggers).toHaveLength(0);
    watcher.stop();
  });
});
