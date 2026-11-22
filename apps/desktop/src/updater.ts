import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream, existsSync } from 'node:fs';
import { access, mkdtemp } from 'node:fs/promises';
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
import { signedLikeRunningApp } from './signature.js';
import {
  canonicalPath,
  isStagedBundleFor,
  removeFolder,
  removeFolderAfterExit,
  removeStagingFolders,
  STAGING_PREFIX,
} from './update-staging.js';
import {
  readUpdateState,
  shouldStage,
  stagedFor,
  updateStatePath,
  writeUpdateState,
} from './update-state.js';
import {
  APP_BUNDLE_NAME,
  APP_EXECUTABLE,
  applyStagedUpdate,
  previousAppPath,
  readBundleVersion,
} from './update-swap.js';

const run = promisify(execFile);
const REQUEST_HEADERS = { 'User-Agent': 'Cairn-Desktop' };
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

async function download(
  update: DesktopUpdate,
  target: string,
  onPercent: (percent: number) => void,
): Promise<void> {
  const response = await fetch(update.url, { headers: REQUEST_HEADERS });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed with HTTP ${response.status}`);
  }
  const hash = createHash('sha256');
  const file = createWriteStream(target);
  let received = 0;
  let reported = -1;
  for await (const chunk of response.body) {
    hash.update(chunk);
    received += chunk.byteLength;
    if (!file.write(chunk)) await new Promise((drained) => file.once('drain', drained));
    const percent = Math.min(99, Math.floor((received / update.size) * 100));
    if (percent !== reported) {
      reported = percent;
      onPercent(percent);
    }
  }
  await new Promise<void>((closed, failed) =>
    file.end((error?: Error | null) => (error ? failed(error) : closed())),
  );
  if (hash.digest('hex') !== update.sha256)
    throw new Error('the download does not match its SHA-256 digest');
}

export function relaunchArgs(background: boolean): string[] {
  const args = process.argv.slice(1).filter((arg) => arg !== BACKGROUND_LAUNCH_FLAG);
  return background ? [...args, BACKGROUND_LAUNCH_FLAG] : args;
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
    const bundle = runningBundle();
    const staging = await mkdtemp(join(dirname(bundle), STAGING_PREFIX));
    try {
      set({ status: 'downloading', version: update.version, percent: 0 });
      const zip = join(staging, `Cairn-${update.version}.zip`);
      await download(update, zip, (percent) =>
        set({ status: 'downloading', version: update.version, percent }),
      );
      set({ status: 'installing', version: update.version });
      await run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
      const stagedApp = join(staging, APP_BUNDLE_NAME);
      const version = await readBundleVersion(stagedApp);
      if (version !== update.version) {
        throw new Error(
          `the downloaded app is version ${version ?? 'unknown'}, not ${update.version}`,
        );
      }
      const previous = readUpdateState(statePath());
      writeUpdateState(statePath(), {
        ...previous,
        staged: {
          version: update.version,
          zip,
          app: stagedApp,
          previousVersion: app.getVersion(),
          at: Date.now(),
        },
      });
      set({ status: 'ready', version: update.version });
    } catch (error) {
      await removeFolder(staging).catch(() => {});
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
      const response = await fetch(DESKTOP_MANIFEST_URL, { headers: REQUEST_HEADERS });
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
