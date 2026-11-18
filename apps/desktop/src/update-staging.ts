import { execFile, spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const REMOVE = '/bin/rm';
const SHELL = '/bin/sh';
const WAIT_FOR_EXIT = 'while kill -0 "$1" 2>/dev/null; do sleep 1; done; exec /bin/rm -rf "$2"';

export const STAGING_PREFIX = '.cairn-update-';

export async function removeFolder(path: string): Promise<void> {
  await run(REMOVE, ['-rf', path]);
}

export async function removeStagingFolders(folder: string): Promise<void> {
  const entries = await readdir(folder).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(STAGING_PREFIX))
      .map((name) => removeFolder(join(folder, name)).catch(() => {})),
  );
}

export function removeFolderAfterExit(path: string, pid: number): void {
  spawn(SHELL, ['-c', WAIT_FOR_EXIT, 'sh', String(pid), path], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}
