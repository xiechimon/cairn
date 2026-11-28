import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { DesktopUpdate, DesktopUpdateBlocker, DesktopUpdateState } from '@cairn/shared';
import { app } from 'electron';
import { LAUNCH_SETTLED_FLAG } from './launch-update.js';
import {
  afterSwap,
  download,
  fetchOfferedUpdate,
  folderWritable,
  SIGNATURE_REFUSAL,
  SignatureRefused,
  StagedUnusable,
  stageBundle,
  swapInStaged,
  verifyStaged,
} from './update-core.js';
import { messageOf, updateFailureState } from './update-error.js';
import { acquireUpdateLock, updateLockPath } from './update-lock.js';
import { canonicalPath, removeFolderAfterExit, removeStagingFolders } from './update-staging.js';
import {
  readUpdateState,
  shouldStage,
  stagedFor,
  updateStatePath,
  writeUpdateState,
} from './update-state.js';
import { APP_EXECUTABLE } from './update-swap.js';

const QUIT_FALLBACK_MS = 30_000;
const APPLY_LOCK_WAIT_MS = 15_000;
export const BACKGROUND_LAUNCH_FLAG = '--cairn-background-launch';

export type ApplyWhen = 'none' | 'background' | 'foreground';

export interface Updater {
  state(): DesktopUpdateState;
  check(): Promise<void>;
  install(): Promise<void>;
  apply(when: ApplyWhen): Promise<void>;
}

export function runningBundle(): string {
  return canonicalPath(resolve(process.execPath, '..', '..', '..'));
}

export async function updateBlocker(bundle: string): Promise<DesktopUpdateBlocker | null> {
  if (process.platform === 'win32') {
    return app.isPackaged ? null : 'development';
  }
  if (!app.isPackaged || !bundle.endsWith('.app')) return 'development';
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return 'not-in-applications';
  }
  return (await folderWritable(bundle)) ? null : 'read-only';
}

export async function removeLeftoverUpdates(): Promise<void> {
  const bundle = runningBundle();
  if (!app.isPackaged || !bundle.endsWith('.app')) return;
  const staged = readUpdateState(updateStatePath(app.getPath('userData'))).staged;
  await removeStagingFolders(dirname(bundle), staged === null ? [] : [staged.app]);
}

export { messageOf } from './update-error.js';

export function relaunchArgs(background: boolean): string[] {
  const args = process.argv
    .slice(1)
    .filter((arg) => arg !== BACKGROUND_LAUNCH_FLAG && arg !== LAUNCH_SETTLED_FLAG);
  return background ? [...args, BACKGROUND_LAUNCH_FLAG] : args;
}

function relaunch(when: Exclude<ApplyWhen, 'none'>): void {
  app.relaunch({ args: relaunchArgs(when === 'background') });
  setTimeout(() => app.exit(0), QUIT_FALLBACK_MS).unref();
  app.quit();
}

export interface UpdaterHooks {
  beforeRelaunch(): void;
}

export function createUpdater(
  publish: (state: DesktopUpdateState) => void,
  hooks: UpdaterHooks,
): Updater {
  const statePath = (): string => updateStatePath(app.getPath('userData'));
  const recorded = readUpdateState(statePath());
  const offered = stagedFor(recorded, app.getVersion());
  const stagedExists = (stagedApp: string): boolean =>
    process.platform === 'win32'
      ? existsSync(stagedApp)
      : existsSync(join(stagedApp, APP_EXECUTABLE));
  const stagedNow = offered !== null && stagedExists(offered.app) ? offered : null;
  if (recorded.staged !== null && stagedNow === null) {
    writeUpdateState(statePath(), { ...recorded, staged: null });
  }
  let current: DesktopUpdateState =
    stagedNow === null ? { status: 'idle' } : { status: 'ready', version: stagedNow.version };
  let pending: DesktopUpdate | null = null;
  const signatureRefusedVersions = new Set<string>();
  const set = (next: DesktopUpdateState): void => {
    current = next;
    publish(next);
  };
  const busy = (): boolean =>
    current.status === 'checking' ||
    current.status === 'downloading' ||
    current.status === 'installing' ||
    current.status === 'restarting';
  const readyVersion = (): string | null => {
    const candidate = stagedFor(readUpdateState(statePath()), app.getVersion());
    return candidate !== null && stagedExists(candidate.app) ? candidate.version : null;
  };

  async function stage(update: DesktopUpdate): Promise<void> {
    if (process.platform === 'win32') {
      const updatesDir = join(app.getPath('userData'), 'updates');
      await mkdir(updatesDir, { recursive: true });
      const exePath = join(updatesDir, `Cairn-${update.version}-win-${process.arch}.exe`);
      try {
        set({ status: 'downloading', version: update.version, percent: 0 });
        await download(update, exePath, (percent) =>
          set({ status: 'downloading', version: update.version, percent }),
        );
        const previous = readUpdateState(statePath());
        writeUpdateState(statePath(), {
          ...previous,
          staged: {
            version: update.version,
            zip: exePath,
            app: exePath,
            previousVersion: app.getVersion(),
            at: Date.now(),
          },
        });
        set({ status: 'ready', version: update.version });
      } catch (error) {
        set(updateFailureState(error, readyVersion()));
      }
      return;
    }
    try {
      const staged = await stageBundle(runningBundle(), update, app.getVersion(), {
        downloading: (percent) => set({ status: 'downloading', version: update.version, percent }),
        extracting: () => set({ status: 'installing', version: update.version }),
      });
      writeUpdateState(statePath(), { ...readUpdateState(statePath()), staged });
      set({ status: 'ready', version: update.version });
    } catch (error) {
      set(updateFailureState(error, readyVersion()));
    }
  }

  async function check(): Promise<void> {
    if (busy()) return;
    const blocker = await updateBlocker(runningBundle());
    if (blocker !== null) {
      set({ status: 'unsupported', blocker });
      return;
    }
    set({ status: 'checking' });
    try {
      pending = await fetchOfferedUpdate(app.getVersion());
      if (pending === null) {
        set({ status: 'current', version: app.getVersion() });
        return;
      }
      let record = readUpdateState(statePath());
      if (record.staged !== null && readyVersion() === null) {
        await discardStaged(record);
        record = readUpdateState(statePath());
      }
      if (record.staged === null && signatureRefusedVersions.has(pending.version)) {
        set({ status: 'error', message: SIGNATURE_REFUSAL });
        return;
      }
      if (shouldStage(record, pending.version)) {
        set({ status: 'available', version: pending.version });
        await stage(pending);
        return;
      }
      set(
        record.staged === null
          ? { status: 'available', version: pending.version }
          : { status: 'ready', version: record.staged.version },
      );
    } catch (error) {
      set(updateFailureState(error, readyVersion()));
    }
  }

  async function install(): Promise<void> {
    const update = pending;
    if (busy() || current.status === 'ready') {
      return;
    }
    if (update === null) {
      set({ status: 'error', message: 'no update is pending to install' });
      return;
    }
    if (signatureRefusedVersions.has(update.version)) {
      set({ status: 'error', message: SIGNATURE_REFUSAL });
      return;
    }
    await stage(update);
  }

  async function discardStaged(state: ReturnType<typeof readUpdateState>): Promise<void> {
    if (state.staged === null) return;
    writeUpdateState(statePath(), { ...state, staged: null });
    set({ status: 'idle' });
    await removeStagingFolders(dirname(runningBundle()));
  }

  async function apply(when: ApplyWhen): Promise<void> {
    const state = readUpdateState(statePath());
    const staged = stagedFor(state, app.getVersion());
    if (staged === null) {
      if (state.staged !== null) await discardStaged(state);
      if (when === 'foreground') {
        const message = 'the staged update is missing';
        set({ status: 'error', message });
        throw new Error(message);
      }
      return;
    }
    if (current.status === 'restarting') return;
    if (state.repair != null) {
      if (when === 'foreground') {
        const message = 'a held update is waiting for the background updater';
        set({ status: 'error', message });
        throw new Error(message);
      }
      return;
    }
    if (process.platform === 'win32') {
      try {
        if (!existsSync(staged.app)) {
          throw new Error('the staged installer is missing');
        }
        set({ status: 'restarting', version: staged.version });
        writeUpdateState(statePath(), { ...state, staged: null });
        const child = spawn(staged.app, ['/S'], { detached: true, stdio: 'ignore' });
        child.unref();
        if (when === 'none') return;
        setTimeout(() => app.exit(0), QUIT_FALLBACK_MS).unref();
        app.quit();
      } catch (error) {
        set({ status: 'error', message: messageOf(error) });
        throw error;
      }
      return;
    }
    const bundle = runningBundle();
    try {
      set({ status: 'installing', version: staged.version });
      try {
        await verifyStaged(bundle, staged);
      } catch (error) {
        const mismatch = error instanceof SignatureRefused && error.mismatch;
        if (mismatch) signatureRefusedVersions.add(staged.version);
        if (mismatch || error instanceof StagedUnusable) {
          const latest = readUpdateState(statePath());
          if (latest.staged?.app === staged.app) {
            writeUpdateState(statePath(), { ...latest, staged: null });
          }
        }
        throw error;
      }
      const release = await acquireUpdateLock(
        updateLockPath(app.getPath('userData')),
        'app',
        APPLY_LOCK_WAIT_MS,
      );
      if (release === null) throw new Error('another Cairn update is being installed');
      try {
        const installed = await swapInStaged(bundle, staged, app.getVersion());
        writeUpdateState(
          statePath(),
          afterSwap(readUpdateState(statePath()), {
            ...installed,
            guardOwner: 'desktop',
            guardPid: process.pid,
          }),
        );
      } finally {
        release();
      }
      removeFolderAfterExit(dirname(staged.app), process.pid);
      if (when === 'none') return;
      set({ status: 'restarting', version: staged.version });
      hooks.beforeRelaunch();
      relaunch(when);
    } catch (error) {
      set({ status: 'error', message: messageOf(error) });
      throw error;
    }
  }

  return { state: () => current, check, install, apply };
}
