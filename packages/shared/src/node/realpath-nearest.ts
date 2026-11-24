import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

const MAX_SYMLINK_HOPS = 40;
const LOOKUP_ERROR_CODES = new Set([
  'ENOENT',
  'ENOTDIR',
  'ELOOP',
  'EACCES',
  'EPERM',
  'ENAMETOOLONG',
]);

function isLookupError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    LOOKUP_ERROR_CODES.has(error.code)
  );
}

function trimSlashes(path: string): string {
  const collapsed = path.replace(/\/+/g, '/');
  return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
}

function fallbackWithoutFollowing(start: string): string {
  let cursor = start;
  const missing: string[] = [];
  while (true) {
    try {
      return join(realpathSync.native(cursor), ...missing);
    } catch (error) {
      if (!isLookupError(error)) throw error;
      const parent = trimSlashes(dirname(cursor));
      if (parent === cursor) return resolve(start);
      missing.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

export function realpathOfNearest(
  path: string,
  options?: { onLoop?: 'throw' | 'fallback' },
): string {
  if (path.includes('\0')) throw new Error('Path contains a null byte');
  const cwd = process.cwd();
  const start = trimSlashes(
    isAbsolute(path)
      ? path
      : path === ''
        ? cwd
        : cwd === sep
          ? `${sep}${path}`
          : `${cwd}${sep}${path}`,
  );
  let cursor = start;
  const missing: string[] = [];
  let hops = 0;
  while (true) {
    try {
      return join(realpathSync.native(cursor), ...missing);
    } catch (error) {
      if (!isLookupError(error)) throw error;
      let stat: ReturnType<typeof lstatSync> | undefined;
      try {
        stat = lstatSync(cursor, { throwIfNoEntry: false });
      } catch (lstatError) {
        if (!isLookupError(lstatError)) throw lstatError;
        stat = undefined;
      }
      if (stat?.isSymbolicLink() === true) {
        if (++hops > MAX_SYMLINK_HOPS) {
          if (options?.onLoop === 'throw') {
            const loopError = new Error(
              `ELOOP: too many symbolic links encountered, '${path}'`,
            ) as NodeJS.ErrnoException;
            loopError.code = 'ELOOP';
            throw loopError;
          }
          return fallbackWithoutFollowing(start);
        }
        try {
          const parent = trimSlashes(dirname(cursor));
          let realParent = parent;
          try {
            realParent = realpathSync.native(parent);
          } catch (parentError) {
            if (!isLookupError(parentError)) throw parentError;
          }
          const target = readlinkSync(cursor);
          cursor = trimSlashes(
            isAbsolute(target)
              ? target
              : realParent === sep
                ? `${sep}${target}`
                : `${realParent}${sep}${target}`,
          );
          continue;
        } catch (readlinkError) {
          if (!isLookupError(readlinkError)) throw readlinkError;
        }
      }
      const parent = trimSlashes(dirname(cursor));
      if (parent === cursor) return resolve(start);
      missing.unshift(basename(cursor));
      cursor = parent;
    }
  }
}
