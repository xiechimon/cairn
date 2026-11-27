import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';

export interface ProtectedFolderOpts {
  homeDir?: string;
  platform?: NodeJS.Platform;
  realpath?: (p: string) => string;
  exists?: (p: string) => boolean;
}

export function protectedFolderReason(
  rawPath: string,
  opts: ProtectedFolderOpts = {},
): string | null {
  if (!isAbsolute(rawPath)) return 'the working folder must be an absolute path';
  const requested = resolve(rawPath);
  const platform = opts.platform ?? process.platform;
  const realpath = opts.realpath ?? ((p: string) => realpathSync.native(p));
  const exists = opts.exists ?? existsSync;
  let canonical = requested;
  try {
    canonical = realpath(requested);
  } catch {}
  const same = (a: string, b: string) =>
    platform === 'win32' || platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (canonical === parse(canonical).root || requested === parse(requested).root) {
    return 'cannot use the filesystem root folder';
  }
  const requestedHome = resolve(opts.homeDir ?? homedir());
  let canonicalHome = requestedHome;
  if (exists(requestedHome)) {
    try {
      canonicalHome = realpath(requestedHome);
    } catch {}
  }
  if (same(requested, requestedHome) || same(canonical, canonicalHome)) {
    return 'cannot use the home folder';
  }
  for (const name of ['Desktop', 'Documents', 'Downloads']) {
    const requestedProtected = join(requestedHome, name);
    let canonicalProtected = requestedProtected;
    if (exists(requestedProtected)) {
      try {
        canonicalProtected = realpath(requestedProtected);
      } catch {}
    }
    if (same(requested, requestedProtected) || same(canonical, canonicalProtected)) {
      return `cannot use the ${name} folder`;
    }
  }
  return null;
}
