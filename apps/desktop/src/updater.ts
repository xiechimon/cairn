import { execFile } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  DESKTOP_MANIFEST_URL,
  type DesktopUpdate,
  type DesktopUpdateBlocker,
  type DesktopUpdateState,
  desktopReleaseManifestSchema,
  desktopUpdateFrom,
} from '@cairn/shared';
import { app } from 'electron';
import { parseSigningIdentity, signatureMatches } from './signature.js';
import { stageUpdate, UPDATE_REQUEST_HEADERS } from './update-stage.js';
import {
  canonicalPath,
  isStagedBundleFor,
  removeFolder,
  removeFolderAfterExit,
  removeStagingFolders,
} from './update-staging.js';
import {
  readUpdateState,
  shouldStage,
  stagedFor,
  updateStatePath,
  writeUpdateState,
} from './update-state.js';
import {
  APP_EXECUTABLE,
  applyStagedUpdate,
  previousAppPath,
  readBundleVersion,
} from './update-swap.js';

const run = promisify(execFile);
const NO_MANIFEST = 404;
const QUIT_FALLBACK_MS = 30_000;
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

async function updateBlocker(bundle: string): Promise<DesktopUpdateBlocker | null> {
  if (!app.isPackaged || !bundle.endsWith('.app')) return 'development';
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return 'not-in-applications';
  }
  return access(dirname(bundle), constants.W_OK).then(
    () => null,
    () => 'read-only' as const,
  );
}

export async function removeLeftoverUpdates(): Promise<void> {
  const bundle = runningBundle();
  if (!app.isPackaged || !bundle.endsWith('.app')) return;
  const staged = readUpdateState(updateStatePath(app.getPath('userData'))).staged;
  await removeStagingFolders(dirname(bundle), staged === null ? [] : [staged.app]);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function relaunchArgs(background: boolean): string[] {
  const args = process.argv.slice(1).filter((arg) => arg !== BACKGROUND_LAUNCH_FLAG);
  return background ? [...args, BACKGROUND_LAUNCH_FLAG] : args;
}

async function codesignIdentity(appPath: string): Promise<{ verified: boolean; identity: string }> {
  const [details, verified] = await Promise.all([
    run('/usr/bin/codesign', ['-d', '--verbose=4', appPath]).then(
      (result) => result.stdout,
      () => '',
    ),
    run('/usr/bin/codesign', ['--verify', '--strict', appPath]).then(
      () => true,
      () => false,
    ),
  ]);
  return { verified, identity: details };
}

async function signedLikeRunningApp(bundle: string, stagedApp: string): Promise<boolean> {
  const [running, staged] = await Promise.all([
    codesignIdentity(bundle),
    codesignIdentity(stagedApp),
  ]);
  if (!running.verified) return true;
  return (
    staged.verified &&
    signatureMatches(parseSigningIdentity(running.identity), parseSigningIdentity(staged.identity))
  );
}

function relaunch(when: Exclude<ApplyWhen, 'none'>): void {
  app.relaunch({ args: relaunchArgs(when === 'background') });
  setTimeout(() => app.exit(0), QUIT_FALLBACK_MS).unref();
  app.quit();
}

export function createUpdater(publish: (state: DesktopUpdateState) => void): Updater {
  const statePath = (): string => updateStatePath(app.getPath('userData'));
  const recorded = readUpdateState(statePath());
  const offered = stagedFor(recorded, app.getVersion());
  const stagedNow =
    offered !== null && existsSync(join(offered.app, APP_EXECUTABLE)) ? offered : null;
  if (recorded.staged !== null && stagedNow === null) {
    writeUpdateState(statePath(), { ...recorded, staged: null });
  }
  let current: DesktopUpdateState =
    stagedNow === null ? { status: 'idle' } : { status: 'ready', version: stagedNow.version };
  let pending: DesktopUpdate | null = null;
  const set = (next: DesktopUpdateState): void => {
    current = next;
    publish(next);
  };
  const busy = (): boolean =>
    current.status === 'checking' ||
    current.status === 'downloading' ||
    current.status === 'installing' ||
    current.status === 'restarting';

  async function stage(update: DesktopUpdate): Promise<void> {
    try {
      set({ status: 'downloading', version: update.version, percent: 0 });
      const staged = await stageUpdate({
        statePath: statePath(),
        bundleFolder: dirname(runningBundle()),
        runningVersion: app.getVersion(),
        update,
        onProgress: (phase, percent) => set({ status: phase, version: update.version, percent }),
      });
      set({ status: 'ready', version: staged.version });
    } catch (error) {
      const kept = stagedFor(readUpdateState(statePath()), app.getVersion());
      if (kept !== null && existsSync(join(kept.app, APP_EXECUTABLE))) {
        set({ status: 'ready', version: kept.version });
        return;
      }
      set({ status: 'error', message: messageOf(error) });
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
      const response = await fetch(DESKTOP_MANIFEST_URL, { headers: UPDATE_REQUEST_HEADERS });
      if (!response.ok && response.status !== NO_MANIFEST) {
        throw new Error(`GitHub answered HTTP ${response.status}`);
      }
      pending = response.ok
        ? desktopUpdateFrom(
            desktopReleaseManifestSchema.parse(await response.json()),
            app.getVersion(),
            process.arch,
          )
        : null;
      if (pending === null) {
        set({ status: 'current', version: app.getVersion() });
        return;
      }
      const record = readUpdateState(statePath());
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
      set({ status: 'error', message: messageOf(error) });
    }
  }

  async function install(): Promise<void> {
    const update = pending;
    if (update === null || busy() || current.status === 'ready') return;
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
      return;
    }
    if (current.status === 'restarting') return;
    const bundle = runningBundle();
    try {
      if (!isStagedBundleFor(bundle, staged.app)) {
        throw new Error('the staged update is not where Cairn put it');
      }
      set({ status: 'installing', version: staged.version });
      if (!(await signedLikeRunningApp(bundle, staged.app))) {
        throw new Error('the staged update is not signed the way this copy of Cairn is');
      }
      const version = await readBundleVersion(staged.app);
      if (version !== staged.version) {
        throw new Error(`the staged app is version ${version ?? 'unknown'}, not ${staged.version}`);
      }
      await removeFolder(previousAppPath(bundle));
      await applyStagedUpdate({
        bundle,
        previousApp: previousAppPath(bundle),
        stagedApp: staged.app,
      });
      writeUpdateState(statePath(), {
        ...state,
        staged: null,
        installed: {
          version: staged.version,
          previousVersion: app.getVersion(),
          previousApp: previousAppPath(bundle),
          at: Date.now(),
        },
      });
      removeFolderAfterExit(dirname(staged.app), process.pid);
      if (when === 'none') return;
      set({ status: 'restarting', version: staged.version });
      relaunch(when);
    } catch (error) {
      set({ status: 'error', message: messageOf(error) });
      throw error;
    }
  }

  return { state: () => current, check, install, apply };
}
