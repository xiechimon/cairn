import { type Dirent, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { FsListEntry, FsListErrorReason, FsListResult } from '@cairn/shared';
import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { HttpError } from '../lib/errors.js';

function reasonForErrno(code: string | undefined): FsListErrorReason {
  if (code === 'EACCES' || code === 'EPERM') return 'not_readable';
  if (code === 'ENOTDIR') return 'not_dir';
  return 'not_found';
}

function errnoHttpError(message: string, err: unknown): HttpError {
  return new HttpError(
    400,
    `${message}: ${(err as Error).message}`,
    reasonForErrno((err as NodeJS.ErrnoException).code),
  );
}

export function listDir(dir: string | undefined): FsListResult {
  const raw = dir === undefined || dir === '' ? homedir() : dir;
  if (!isAbsolute(raw)) {
    throw new HttpError(400, `dir must be an absolute path: ${raw}`, 'not_absolute');
  }
  let real: string;
  try {
    real = realpathSync(resolve(raw));
  } catch (err) {
    throw errnoHttpError('dir not accessible', err);
  }
  let isDir = false;
  try {
    isDir = statSync(real).isDirectory();
  } catch (err) {
    throw errnoHttpError('dir not accessible', err);
  }
  if (!isDir) {
    throw new HttpError(400, `dir is not a directory: ${real}`, 'not_dir');
  }
  let dirents: Dirent[];
  try {
    dirents = readdirSync(real, { withFileTypes: true });
  } catch (err) {
    throw errnoHttpError('dir not readable', err);
  }
  const names: string[] = [];
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      names.push(entry.name);
    } else if (entry.isSymbolicLink()) {
      try {
        if (statSync(join(real, entry.name)).isDirectory()) names.push(entry.name);
      } catch {}
    }
  }
  names.sort((a, b) => a.localeCompare(b));
  const truncated = names.length > FS_LIST_MAX_ENTRIES;
  const entries: FsListEntry[] = names.slice(0, FS_LIST_MAX_ENTRIES).map((name) => ({
    name,
    git: existsSync(join(real, name, '.git')),
  }));
  return { path: real, entries, truncated };
}
