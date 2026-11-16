import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { access, mkdtemp, rename, rm } from 'node:fs/promises';
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

const run = promisify(execFile);
const REQUEST_HEADERS = { 'User-Agent': 'Cairn-Desktop' };
const NO_MANIFEST = 404;
const APP_BUNDLE_NAME = 'Cairn.app';

export interface Updater {
  state(): DesktopUpdateState;
  check(): Promise<void>;
  install(): Promise<void>;
}

function runningBundle(): string {
  return resolve(process.execPath, '..', '..', '..');
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

function messageOf(error: unknown): string {
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

async function swapBundle(bundle: string, staging: string, zip: string): Promise<void> {
  await run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
  const fresh = join(staging, APP_BUNDLE_NAME);
  const previous = join(staging, `previous-${APP_BUNDLE_NAME}`);
  await access(join(fresh, 'Contents', 'MacOS', 'Cairn'), constants.X_OK);
  await rename(bundle, previous);
  try {
    await rename(fresh, bundle);
  } catch (error) {
    await rename(previous, bundle);
    throw error;
  }
}

export function createUpdater(publish: (state: DesktopUpdateState) => void): Updater {
  let current: DesktopUpdateState = { status: 'idle' };
  let pending: DesktopUpdate | null = null;
  const set = (next: DesktopUpdateState): void => {
    current = next;
    publish(next);
  };
  const busy = (): boolean =>
    current.status === 'checking' ||
    current.status === 'downloading' ||
    current.status === 'installing';

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
      set(
        pending === null
          ? { status: 'current', version: app.getVersion() }
          : { status: 'available', version: pending.version },
      );
    } catch (error) {
      set({ status: 'error', message: messageOf(error) });
    }
  }

  async function install(): Promise<void> {
    const update = pending;
    if (update === null || busy()) return;
    const bundle = runningBundle();
    const staging = await mkdtemp(join(dirname(bundle), '.cairn-update-'));
    try {
      set({ status: 'downloading', version: update.version, percent: 0 });
      const zip = join(staging, `Cairn-${update.version}.zip`);
      await download(update, zip, (percent) =>
        set({ status: 'downloading', version: update.version, percent }),
      );
      set({ status: 'installing', version: update.version });
      await swapBundle(bundle, staging, zip);
      await rm(staging, { recursive: true, force: true });
      app.relaunch();
      app.quit();
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      set({ status: 'error', message: messageOf(error) });
    }
  }

  return { state: () => current, check, install };
}
