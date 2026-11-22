import { execFile, spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep as SEPARATOR } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REMOVE = '/bin/rm';
const SHELL = '/bin/sh';
const WAIT_FOR_EXIT = 'while kill -0 "$1" 2>/dev/null; do sleep 1; done; exec /bin/rm -rf "$2"';

export const STAGING_PREFIX = '.cairn-update-';

export async function removeFolder(path: string): Promise<void> {
  await run(REMOVE, ['-rf', path]);
}

export function canonicalPath(path: string): string {
  const absolute = resolve(path);
  let head = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return absolute;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

export function isStagedBundleFor(bundle: string, stagedApp: string): boolean {
  if (!isAbsolute(stagedApp)) return false;
  if (basename(stagedApp) !== basename(bundle)) return false;
  const folder = dirname(stagedApp);
  if (dirname(folder) !== dirname(bundle)) return false;
  if (!basename(folder).startsWith(STAGING_PREFIX)) return false;
  if (canonicalPath(folder) !== folder || canonicalPath(stagedApp) !== stagedApp) return false;
  try {
    return lstatSync(stagedApp).isDirectory();
  } catch {
    return false;
  }
}

export async function removeStagingFolders(
  folder: string,
  keep: readonly string[] = [],
): Promise<void> {
  const directory = canonicalPath(folder);
  const kept = keep.map(canonicalPath);
  const entries = await readdir(folder).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(STAGING_PREFIX))
      .filter((name) => !kept.some((path) => path.startsWith(join(directory, name, SEPARATOR))))
      .map((name) => removeFolder(join(folder, name)).catch(() => {})),
  );
}

export function removeFolderAfterExit(path: string, pid: number): void {
  spawn(SHELL, ['-c', WAIT_FOR_EXIT, 'sh', String(pid), path], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}
