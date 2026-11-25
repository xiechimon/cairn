import { constants } from 'node:fs';
import { access, mkdir, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const APP_BUNDLE_NAME = 'Cairn.app';
export const APP_EXECUTABLE = join('Contents', 'MacOS', 'Cairn');
export const PREVIOUS_DIR = '.cairn-previous';

export interface ApplyPaths {
  bundle: string;
  previousApp: string;
  stagedApp: string;
}

export interface SwapPaths {
  bundle: string;
  previousApp: string;
}

export function previousAppPath(bundle: string): string {
  return join(dirname(bundle), PREVIOUS_DIR, APP_BUNDLE_NAME);
}

export function failedAppPath(bundle: string): string {
  return join(dirname(bundle), PREVIOUS_DIR, `failed-${APP_BUNDLE_NAME}`);
}

export async function readBundleVersion(app: string): Promise<string | null> {
  const plist = await readFile(join(app, 'Contents', 'Info.plist'), 'utf8').catch(() => null);
  if (plist === null) return null;
  const key = '<key>CFBundleShortVersionString</key>';
  const at = plist.indexOf(key);
  if (at === -1) return null;
  const match = /^\s*<string>([^<]+)<\/string>/.exec(plist.slice(at + key.length));
  return match?.[1]?.trim() ?? null;
}

export async function applyStagedUpdate(paths: ApplyPaths): Promise<void> {
  await access(join(paths.stagedApp, APP_EXECUTABLE), constants.X_OK);
  await mkdir(dirname(paths.previousApp), { recursive: true, mode: 0o700 });
  await rename(paths.bundle, paths.previousApp);
  try {
    await rename(paths.stagedApp, paths.bundle);
  } catch (error) {
    await rename(paths.previousApp, paths.bundle);
    throw error;
  }
}

export async function restoreIfBundleMissing(bundle: string): Promise<boolean> {
  const previousApp = previousAppPath(bundle);
  try {
    await access(join(bundle, APP_EXECUTABLE), constants.X_OK);
    return false;
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  try {
    await access(join(previousApp, APP_EXECUTABLE), constants.X_OK);
  } catch {
    return false;
  }
  await mkdir(dirname(previousApp), { recursive: true, mode: 0o700 });
  await rename(previousApp, bundle);
  return true;
}

export async function restorePrevious(paths: SwapPaths): Promise<string> {
  const failed = failedAppPath(paths.bundle);
  await mkdir(dirname(failed), { recursive: true, mode: 0o700 });
  await rename(paths.bundle, failed);
  try {
    await rename(paths.previousApp, paths.bundle);
  } catch (error) {
    await rename(failed, paths.bundle);
    throw error;
  }
  return failed;
}
