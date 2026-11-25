import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  buildResidentPlist,
  clearServerOwner,
  handoffFromResidentHost,
  handoffToResidentHost,
  installResidentHost,
  isResidentInstalled,
  kickstartResidentHost,
  probeResidentServer,
  RESIDENT_LABEL,
  readServerOwner,
  residentPlistPath,
  residentWritingReply,
  resolveResidentAtBoot,
  type ServerOwnerRecord,
  uninstallResidentHost,
  waitForResidentExit,
  waitForResidentServer,
  writeServerOwner,
} from '../src/resident-host.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-resident-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resident host and ownership lock', () => {
  test('writes, probes, and clears server-owner.json safely', async () => {
    const home = tempDir();
    writeServerOwner(home, {
      pid: process.pid,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: Date.now(),
    });
    expect(readServerOwner(home)?.pid).toBe(process.pid);

    const alive = await probeResidentServer(home, async () => new Response('{}', { status: 200 }));
    expect(alive?.origin).toBe('http://127.0.0.1:8787');

    const dead = await probeResidentServer(home, async () => new Response('', { status: 500 }));
    expect(dead).toBeNull();

    clearServerOwner(home, process.pid + 999);
    expect(readServerOwner(home)?.pid).toBe(process.pid);
    clearServerOwner(home, process.pid);
    expect(readServerOwner(home)).toBeNull();
  });

  test('installs plist bound to loopback with CAIRN_MANAGED_BY=launchd and uninstalls cleanly', async () => {
    const home = tempDir();
    const calls: string[][] = [];
    const runLaunchctl = async (args: string[]) => {
      calls.push(args);
    };
    const res = await installResidentHost({
      homeDir: home,
      executablePath: '/Applications/Cairn.app/Contents/MacOS/Cairn',
      serverEntry: '/Applications/Cairn.app/Contents/Resources/server/dist/index.mjs',
      cairnHome: join(home, '.cairn-server'),
      logDir: join(home, 'logs'),
      uid: 501,
      runLaunchctl,
    });
    expect(res.ok).toBe(true);
    expect(isResidentInstalled(home)).toBe(true);
    if (res.ok) {
      const xml = readFileSync(res.plistPath, 'utf8');
      expect(xml).toContain('ELECTRON_RUN_AS_NODE');
      expect(xml).toContain('/Applications/Cairn.app/Contents/MacOS/Cairn');
      expect(xml).toContain('<key>HOST</key>\n    <string>127.0.0.1</string>');
      expect(xml).not.toContain('0.0.0.0');
      expect(xml).toContain('<key>CAIRN_MANAGED_BY</key>\n    <string>launchd</string>');
    }
    expect(calls.some((args) => args[0] === 'bootstrap')).toBe(true);

    await uninstallResidentHost({ homeDir: home, uid: 501, runLaunchctl });
    expect(isResidentInstalled(home)).toBe(false);
  });

  test('kickstartResidentHost no-ops when not installed and kickstarts when installed', async () => {
    const home = tempDir();
    const calls: string[][] = [];
    const runLaunchctl = async (args: string[]) => {
      calls.push(args);
    };

    const skipped = await kickstartResidentHost({ homeDir: home, uid: 501, runLaunchctl });
    expect(skipped).toBe(false);
    expect(calls).toHaveLength(0);

    await installResidentHost({
      homeDir: home,
      executablePath: '/Applications/Cairn.app/Contents/MacOS/Cairn',
      serverEntry: '/Applications/Cairn.app/Contents/Resources/server/dist/index.mjs',
      cairnHome: join(home, '.cairn-server'),
      logDir: join(home, 'logs'),
      uid: 501,
      runLaunchctl,
    });
    calls.length = 0;

    const restarted = await kickstartResidentHost({ homeDir: home, uid: 501, runLaunchctl });
    expect(restarted).toBe(true);
    expect(calls).toEqual([['kickstart', '-k', `gui/501/${RESIDENT_LABEL}`]]);
  });

  test('waitForResidentServer ignores excluded pid and waitForResidentExit waits for shutdown', async () => {
    const home = tempDir();
    const stale: ServerOwnerRecord = {
      pid: 1001,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: 1_000,
    };
    const fresh: ServerOwnerRecord = {
      pid: 1002,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: 2_000,
    };
    let polls = 0;
    const found = await waitForResidentServer(home, {
      excludePid: 1001,
      timeoutMs: 500,
      pollMs: 1,
      sleep: async () => {},
      probe: async () => {
        polls += 1;
        return polls < 3 ? stale : fresh;
      },
    });
    expect(found).toEqual(fresh);

    writeServerOwner(home, {
      pid: process.pid,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: Date.now(),
    });
    let checks = 0;
    const exited = await waitForResidentExit(home, {
      timeoutMs: 500,
      pollMs: 1,
      sleep: async () => {
        checks += 1;
        if (checks >= 2) clearServerOwner(home, process.pid);
      },
    });
    expect(exited).toBe(true);
  });

  test('handoffToResidentHost stops embedded server before installing launchd and rolls back on failure', async () => {
    const order: string[] = [];
    const resident: ServerOwnerRecord = {
      pid: 4242,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: 5_000,
    };
    const result = await handoffToResidentHost({
      hasEmbeddedServer: true,
      stopEmbeddedServer: async () => {
        order.push('stop-embedded');
      },
      restoreEmbeddedServer: async () => {
        order.push('restore-embedded');
      },
      install: async () => {
        order.push('install-resident');
        return { ok: true, plistPath: '/tmp/app.cairn.host.plist', port: 8787 };
      },
      uninstall: async () => {
        order.push('uninstall-resident');
        return { ok: true };
      },
      waitForHealthy: async () => {
        order.push('wait-healthy');
        return resident;
      },
      relaunch: () => {
        order.push('relaunch');
      },
    });
    expect(result).toEqual(resident);
    expect(order).toEqual(['stop-embedded', 'install-resident', 'wait-healthy', 'relaunch']);

    const failOrder: string[] = [];
    await expect(
      handoffToResidentHost({
        hasEmbeddedServer: true,
        stopEmbeddedServer: async () => {
          failOrder.push('stop-embedded');
        },
        restoreEmbeddedServer: async () => {
          failOrder.push('restore-embedded');
        },
        install: async () => {
          failOrder.push('install-resident');
          return { ok: true, plistPath: '/tmp/app.cairn.host.plist', port: 8787 };
        },
        uninstall: async () => {
          failOrder.push('uninstall-resident');
          return { ok: true };
        },
        waitForHealthy: async () => {
          failOrder.push('wait-healthy');
          return null;
        },
        relaunch: () => {
          failOrder.push('relaunch');
        },
      }),
    ).rejects.toThrow();
    expect(failOrder).toEqual([
      'stop-embedded',
      'install-resident',
      'wait-healthy',
      'uninstall-resident',
      'restore-embedded',
    ]);
  });

  test('handoffFromResidentHost uninstalls, waits for exit, and relaunches only when attached', async () => {
    const attachedOrder: string[] = [];
    await handoffFromResidentHost({
      attachedToResident: true,
      uninstall: async () => {
        attachedOrder.push('uninstall');
        return { ok: true };
      },
      waitForExit: async () => {
        attachedOrder.push('wait-exit');
        return true;
      },
      relaunch: () => {
        attachedOrder.push('relaunch');
      },
    });
    expect(attachedOrder).toEqual(['uninstall', 'wait-exit', 'relaunch']);

    const detachedOrder: string[] = [];
    await handoffFromResidentHost({
      attachedToResident: false,
      uninstall: async () => {
        detachedOrder.push('uninstall');
        return { ok: true };
      },
      waitForExit: async () => {
        detachedOrder.push('wait-exit');
        return true;
      },
      relaunch: () => {
        detachedOrder.push('relaunch');
      },
    });
    expect(detachedOrder).toEqual(['uninstall', 'wait-exit']);
  });

  test('resolveResidentAtBoot refreshes outdated plist and kickstarts on version change or stale probe', async () => {
    const home = tempDir();
    const cairnHome = join(home, '.cairn-server');
    const logDir = join(home, 'logs');
    const plistArgs = {
      homeDir: home,
      executablePath: '/Applications/Cairn.app/Contents/MacOS/Cairn',
      serverEntry: '/Applications/Cairn.app/Contents/Resources/server/dist/index.mjs',
      cairnHome,
      logDir,
    };

    const notInstalled = await resolveResidentAtBoot({
      ...plistArgs,
      versionChanged: false,
      updatedAt: null,
      probe: async () => null,
      waitForHealthy: async () => null,
      install: async () => ({ ok: true, plistPath: residentPlistPath(home), port: 8787 }),
      kickstart: async () => true,
    });
    expect(notInstalled).toBeNull();

    const calls: string[][] = [];
    await installResidentHost({
      ...plistArgs,
      uid: 501,
      runLaunchctl: async (args) => {
        calls.push(args);
      },
    });

    const staleXml = buildResidentPlist({ ...plistArgs, port: 8787 }).replace(
      '127.0.0.1',
      '0.0.0.0',
    );
    writeFileSync(residentPlistPath(home), staleXml, 'utf8');

    const freshRecord: ServerOwnerRecord = {
      pid: 7002,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: 9_000,
    };
    const actions: string[] = [];
    const upgraded = await resolveResidentAtBoot({
      ...plistArgs,
      versionChanged: false,
      updatedAt: null,
      probe: async () => null,
      waitForHealthy: async () => freshRecord,
      install: async () => {
        actions.push('reinstall');
        writeFileSync(residentPlistPath(home), buildResidentPlist({ ...plistArgs, port: 8787 }));
        return { ok: true, plistPath: residentPlistPath(home), port: 8787 };
      },
      kickstart: async () => {
        actions.push('kickstart');
        return true;
      },
    });
    expect(upgraded).toEqual(freshRecord);
    expect(actions).toEqual(['reinstall']);

    const oldRecord: ServerOwnerRecord = {
      pid: 7001,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: 1_000,
    };
    actions.length = 0;
    let excludedPid: number | undefined;
    const afterUpdate = await resolveResidentAtBoot({
      ...plistArgs,
      versionChanged: true,
      updatedAt: 5_000,
      probe: async () => oldRecord,
      waitForHealthy: async (opts) => {
        excludedPid = opts?.excludePid;
        return freshRecord;
      },
      install: async () => {
        actions.push('reinstall');
        return { ok: true, plistPath: residentPlistPath(home), port: 8787 };
      },
      kickstart: async () => {
        actions.push('kickstart');
        return true;
      },
    });
    expect(afterUpdate).toEqual(freshRecord);
    expect(actions).toEqual(['kickstart']);
    expect(excludedPid).toBe(7001);
  });

  test('residentWritingReply holds when GET /api/server/version reports busy for a claimed step and falls back on 404', async () => {
    const home = tempDir();
    writeServerOwner(home, {
      pid: process.pid,
      port: 8787,
      origin: 'http://127.0.0.1:8787',
      managedBy: 'launchd',
      startedAt: Date.now(),
    });
    const paths: string[] = [];
    const busyByVersion = await residentWritingReply(home, 'tok', async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === '/api/remote/descriptor') return new Response('{}', { status: 200 });
      if (path === '/api/server/version') {
        return new Response(
          JSON.stringify({
            version: '0.1.730',
            commit: 'abc1234',
            busy: true,
            updater: { supported: true, state: 'idle', reason: null },
          }),
          { status: 200 },
        );
      }
      if (path === '/api/teams') return new Response('[]', { status: 200 });
      return new Response('', { status: 404 });
    });
    expect(busyByVersion).toBe(true);
    expect(paths).toContain('/api/server/version');

    const idleByVersion = await residentWritingReply(home, 'tok', async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/remote/descriptor') return new Response('{}', { status: 200 });
      if (path === '/api/server/version') {
        return new Response(
          JSON.stringify({
            version: '0.1.730',
            commit: 'abc1234',
            busy: false,
            updater: { supported: true, state: 'idle', reason: null },
          }),
          { status: 200 },
        );
      }
      if (path === '/api/teams') {
        return new Response(JSON.stringify([{ id: 't1' }]), { status: 200 });
      }
      if (path === '/api/teams/t1/chief/threads') {
        return new Response(JSON.stringify([{ activeRun: { id: 'run-1' } }]), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    expect(idleByVersion).toBe(false);

    const legacyBusy = await residentWritingReply(home, 'tok', async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/remote/descriptor') return new Response('{}', { status: 200 });
      if (path === '/api/server/version') return new Response('', { status: 404 });
      if (path === '/api/teams')
        return new Response(JSON.stringify([{ id: 't1' }]), { status: 200 });
      if (path === '/api/teams/t1/chief/threads') {
        return new Response(JSON.stringify([{ turnQueue: { id: 'q1' } }]), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    expect(legacyBusy).toBe(true);
  });
});
