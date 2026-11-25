import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DesktopUpdate } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  type BackgroundDeps,
  parseBatteryLow,
  runBackgroundUpdate,
} from '../src/background-update.js';
import { settleBundleAtLaunch } from '../src/launch-update.js';
import { finishQuit } from '../src/quit-steps.js';
import { swapInStaged, verifyStaged } from '../src/update-core.js';
import { acquireUpdateLock, updateLockPath } from '../src/update-lock.js';
import { STAGING_PREFIX } from '../src/update-staging.js';
import {
  emptyUpdateState,
  readUpdateState,
  type StagedUpdate,
  updateStatePath,
  writeUpdateState,
} from '../src/update-state.js';
import { readBundleVersion } from '../src/update-swap.js';
import { buildUpdaterPlist, ensureUpdaterAgent } from '../src/updater-agent.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeBundle(app: string, version: string): void {
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`,
  );
  writeFileSync(join(app, 'Contents', 'MacOS', 'Cairn'), '#!/bin/sh\n');
  chmodSync(join(app, 'Contents', 'MacOS', 'Cairn'), 0o755);
}

function mac(version = '1.0.0'): { bundle: string; userData: string; root: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-bg-')));
  roots.push(root);
  const applications = join(root, 'Applications');
  const userData = join(root, 'userData');
  mkdirSync(applications);
  mkdirSync(userData);
  const bundle = join(applications, 'Cairn.app');
  writeBundle(bundle, version);
  return { bundle, userData, root };
}

const offer = (version: string): DesktopUpdate => ({
  version,
  url: `https://example.test/Cairn-${version}.zip`,
  sha256: 'a'.repeat(64),
  size: 1,
});

async function stageFake(bundle: string, version: string, from: string): Promise<StagedUpdate> {
  const staging = await mkdtemp(join(dirname(bundle), STAGING_PREFIX));
  const app = join(staging, 'Cairn.app');
  writeBundle(app, version);
  return { version, zip: join(staging, 'x.zip'), app, previousVersion: from, at: 1 };
}

interface World {
  deps: BackgroundDeps;
  log: string[];
  downloads: string[];
  restarts: number;
  app: { running: boolean; startsDuringDownload: boolean };
  battery: { low: boolean };
  resident: { busy: boolean };
  release: { offered: string | null };
}

function world(bundle: string, userData: string): World {
  const w: World = {
    log: [],
    downloads: [],
    restarts: 0,
    app: { running: false, startsDuringDownload: false },
    battery: { low: false },
    resident: { busy: false },
    release: { offered: '1.1.0' },
    deps: undefined as unknown as BackgroundDeps,
  };
  w.deps = {
    bundle,
    userData,
    bundleVersion: () => readBundleVersion(bundle),
    writable: async () => true,
    appRunning: () => w.app.running,
    lowBattery: async () => w.battery.low,
    offeredUpdate: async () => (w.release.offered === null ? null : offer(w.release.offered)),
    stage: async (update, from) => {
      w.downloads.push(update.version);
      const staged = await stageFake(bundle, update.version, from);
      if (w.app.startsDuringDownload) w.app.running = true;
      return staged;
    },
    verify: (staged) => verifyStaged(bundle, staged, async () => 'accepted'),
    swap: (staged, from) => swapInStaged(bundle, staged, from),
    lock: () => acquireUpdateLock(updateLockPath(userData), 'background-updater', 0),
    residentBusy: async () => w.resident.busy,
    restartResident: async () => {
      w.restarts += 1;
    },
    log: (line) => w.log.push(line),
  };
  return w;
}

const stagingFolders = (bundle: string): string[] =>
  readdirSync(dirname(bundle)).filter((name) => name.startsWith(STAGING_PREFIX));

describe('a release published while Cairn is closed', () => {
  test('is installed before the user opens Cairn, and the next open is on probation', async () => {
    const { bundle, userData } = mac();
    const w = world(bundle, userData);
    expect(await runBackgroundUpdate(w.deps)).toBe('installed');
    expect(await readBundleVersion(bundle)).toBe('1.1.0');
    const state = readUpdateState(updateStatePath(userData));
    expect(state.installed).toMatchObject({ version: '1.1.0', previousVersion: '1.0.0' });
    expect(state.staged).toBeNull();
    expect(state.knownVersion).toBe('1.1.0');
    expect(await readBundleVersion(state.installed?.previousApp ?? '')).toBe('1.0.0');
    expect(stagingFolders(bundle)).toEqual([]);
    expect(w.restarts).toBe(1);
  });

  test('waits while Cairn is open; the open app updates itself', async () => {
    const { bundle, userData } = mac();
    const w = world(bundle, userData);
    w.app.running = true;
    expect(await runBackgroundUpdate(w.deps)).toBe('app-running');
    expect(w.downloads).toEqual([]);
  });

  test('gives up its download when the user opens Cairn meanwhile', async () => {
    const { bundle, userData } = mac();
    const w = world(bundle, userData);
    w.app.startsDuringDownload = true;
    expect(await runBackgroundUpdate(w.deps)).toBe('app-running');
    expect(await readBundleVersion(bundle)).toBe('1.0.0');
    expect(stagingFolders(bundle)).toEqual([]);
  });

  test('skips a laptop on battery below 20%', async () => {
    const { bundle, userData } = mac();
    const w = world(bundle, userData);
    w.battery.low = true;
    expect(await runBackgroundUpdate(w.deps)).toBe('low-battery');
    expect(w.downloads).toEqual([]);
    expect(
      parseBatteryLow(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t19%; discharging; 1:02 remaining present: true",
      ),
    ).toBe(true);
    expect(
      parseBatteryLow(
        "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t5%; charging; present: true",
      ),
    ).toBe(false);
    expect(
      parseBatteryLow(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t20%; discharging",
      ),
    ).toBe(false);
    expect(parseBatteryLow("Now drawing from 'AC Power'\n")).toBe(false);
  });

  test('never replaces a version still on probation, so its kept copy survives', async () => {
    const { bundle, userData } = mac();
    writeUpdateState(updateStatePath(userData), {
      ...emptyUpdateState(),
      installed: { version: '1.0.0', previousVersion: '0.9.0', previousApp: 'x', at: 1 },
    });
    const w = world(bundle, userData);
    expect(await runBackgroundUpdate(w.deps)).toBe('unconfirmed');
    expect(w.downloads).toEqual([]);
  });

  test('skips a version that already failed to start', async () => {
    const { bundle, userData } = mac();
    writeUpdateState(updateStatePath(userData), {
      ...emptyUpdateState(),
      blocked: { version: '1.1.0', at: 1, reason: 'crashed', attempts: 1 },
    });
    const w = world(bundle, userData);
    expect(await runBackgroundUpdate(w.deps)).toBe('blocked');
    expect(w.downloads).toEqual([]);
  });

  test('holds while the resident server writes a reply, then reuses the download', async () => {
    const { bundle, userData } = mac();
    const w = world(bundle, userData);
    w.resident.busy = true;
    expect(await runBackgroundUpdate(w.deps)).toBe('resident-busy');
    expect(await readBundleVersion(bundle)).toBe('1.0.0');
    expect(w.restarts).toBe(0);
    w.resident.busy = false;
    expect(await runBackgroundUpdate(w.deps)).toBe('installed');
    expect(w.downloads).toEqual(['1.1.0']);
    expect(await readBundleVersion(bundle)).toBe('1.1.0');
  });

  test('a copy installed by hand is noted in the update log and still updated', async () => {
    const { bundle, userData } = mac('1.0.5');
    writeUpdateState(updateStatePath(userData), { ...emptyUpdateState(), knownVersion: '1.0.0' });
    const w = world(bundle, userData);
    expect(await runBackgroundUpdate(w.deps)).toBe('installed');
    expect(w.log[0]).toBe('found 1.0.5 installed outside the updater (last known 1.0.0)');
  });
});

describe('the user opens Cairn while the background updater swaps it', () => {
  test('the app waits for the swap and then opens the whole new version', async () => {
    const { bundle, userData } = mac();
    const lock = updateLockPath(userData);
    const agent = await acquireUpdateLock(lock, 'background-updater', 0);
    expect(agent).not.toBeNull();
    let appGotLock = false;
    const opening = acquireUpdateLock(lock, 'app', 5_000).then((release) => {
      appGotLock = true;
      return release;
    });
    await new Promise((settle) => setTimeout(settle, 250));
    expect(appGotLock).toBe(false);
    await swapInStaged(bundle, await stageFake(bundle, '1.1.0', '1.0.0'), '1.0.0');
    agent?.();
    const release = await opening;
    expect(release).not.toBeNull();
    const verdict = await settleBundleAtLaunch({
      bundle,
      userData,
      runningVersion: '1.0.0',
      settled: false,
      log: () => {},
    });
    release?.();
    expect(verdict).toBe('relaunch');
  });

  test('a lock left by a process that died does not block anyone', async () => {
    const { userData } = mac();
    writeFileSync(
      updateLockPath(userData),
      JSON.stringify({ pid: 999_999, holder: 'background-updater', at: Date.now() }),
    );
    expect(await acquireUpdateLock(updateLockPath(userData), 'app', 0)).not.toBeNull();
  });
});

describe('a download Cairn already has when it opens', () => {
  test('is installed before the window opens, without the network', async () => {
    const { bundle, userData } = mac();
    const staged = await stageFake(bundle, '1.1.0', '1.0.0');
    writeUpdateState(updateStatePath(userData), { ...emptyUpdateState(), staged });
    const log: string[] = [];
    const verdict = await settleBundleAtLaunch({
      bundle,
      userData,
      runningVersion: '1.0.0',
      settled: false,
      verify: async () => 'accepted',
      log: (line) => log.push(line),
    });
    expect(verdict).toBe('relaunch');
    expect(await readBundleVersion(bundle)).toBe('1.1.0');
    expect(readUpdateState(updateStatePath(userData)).installed?.version).toBe('1.1.0');
  });

  test('a download signed by someone else is dropped and the old version opens', async () => {
    const { bundle, userData } = mac();
    const staged = await stageFake(bundle, '1.1.0', '1.0.0');
    writeUpdateState(updateStatePath(userData), { ...emptyUpdateState(), staged });
    const verdict = await settleBundleAtLaunch({
      bundle,
      userData,
      runningVersion: '1.0.0',
      settled: false,
      verify: async () => 'requirement-mismatch',
      log: () => {},
    });
    expect(verdict).toBe('continue');
    expect(await readBundleVersion(bundle)).toBe('1.0.0');
    expect(readUpdateState(updateStatePath(userData)).staged).toBeNull();
  });

  test('the relaunched copy does not swap again', async () => {
    const { bundle, userData } = mac('1.1.0');
    expect(
      await settleBundleAtLaunch({
        bundle,
        userData,
        runningVersion: '1.0.0',
        settled: true,
        log: () => {},
      }),
    ).toBe('continue');
  });
});

describe('quitting Cairn', () => {
  test('installs the download even when Cairn uses a remote or resident server', async () => {
    const order: string[] = [];
    await finishQuit({
      stopHelpers: async () => order.push('runner'),
      stopOwnServer: null,
      rollingBack: () => false,
      applyUpdate: async () => {
        order.push('apply');
      },
    });
    expect(order).toEqual(['runner', 'apply']);
  });

  test('a rollback in progress is not overwritten by the download', async () => {
    const order: string[] = [];
    await finishQuit({
      stopHelpers: async () => order.push('runner'),
      stopOwnServer: async () => {
        order.push('server');
      },
      rollingBack: () => true,
      applyUpdate: async () => {
        order.push('apply');
      },
    });
    expect(order).toEqual(['runner', 'server']);
  });
});

function plistEntry(plist: string, key: string): string {
  const after = plist.split(`<key>${key}</key>`)[1] ?? '';
  return after.slice(0, after.indexOf('\n  <key>')).trim();
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

describe('the background updater registration', () => {
  test('is written once, so macOS shows its notice only once', async () => {
    const { root, userData } = mac();
    const paths = {
      executablePath: '/Applications/Cairn.app/Contents/MacOS/Cairn',
      entry: '/Applications/Cairn.app/Contents/Resources/background-updater.mjs',
      userData,
      plistPath: join(root, 'LaunchAgents', 'app.cairn.updater.plist'),
    };
    const calls: string[][] = [];
    const launchctl = async (args: string[]): Promise<void> => {
      calls.push(args);
    };
    expect(await ensureUpdaterAgent(paths, launchctl, 501)).toBe('installed');
    expect(await ensureUpdaterAgent(paths, launchctl, 501)).toBe('unchanged');
    expect(calls.map((args) => args[0])).toEqual(['bootout', 'bootstrap']);
    const plist = readFileSync(paths.plistPath, 'utf8');
    expect(plistEntry(plist, 'ProcessType')).toBe('<string>Background</string>');
    expect(plistEntry(plist, 'AssociatedBundleIdentifiers')).toBe(
      '<array><string>io.github.xiechimon.cairn</string></array>',
    );
    const [first = 0, second = 0] = [
      ...plistEntry(plist, 'StartCalendarInterval').matchAll(/<integer>(\d+)<\/integer>/g),
    ].map((match) => Number(match[1]));
    expect(second - first).toBe(30);
    expect(plist).not.toContain('<key>StartInterval</key>');
  });

  test('removes itself once Cairn is moved to the Trash', () => {
    const { root, userData } = mac();
    const plistPath = join(root, 'app.cairn.updater.plist');
    const label = `test.cairn.updater.${process.pid}`;
    writeFileSync(
      plistPath,
      buildUpdaterPlist({
        executablePath: join(root, 'Trash', 'Cairn.app', 'Contents', 'MacOS', 'Cairn'),
        entry: join(root, 'background-updater.mjs'),
        userData,
        plistPath,
        label,
      }),
    );
    const [program, ...args] = [
      ...plistEntry(readFileSync(plistPath, 'utf8'), 'ProgramArguments').matchAll(
        /<string>([^<]*)<\/string>/g,
      ),
    ].map((match) => unescapeXml(match[1] ?? ''));
    try {
      execFileSync(program ?? '', args, { stdio: 'ignore' });
    } catch {}
    expect(existsSync(plistPath)).toBe(false);
  });
});
