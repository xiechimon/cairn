import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { HttpError } from './errors.js';

function stripUncPrefix(path: string): string {
  return path.startsWith('\\\\?\\') ? path.slice(4) : path;
}

export function requireRealpath(path: string): string {
  try {
    return stripUncPrefix(realpathSync.native(path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'EIO';
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new HttpError(400, 'path does not exist', 'not_found');
    }
    throw new HttpError(400, `cannot verify the real path (${code})`);
  }
}

export function realpathOrResolve(path: string): string {
  const missing: string[] = [];
  for (let ancestor = path; ; ancestor = dirname(ancestor)) {
    try {
      return join(requireRealpath(ancestor), ...missing.reverse());
    } catch (error) {
      if (!(error instanceof HttpError) || error.reason !== 'not_found') throw error;
      if (dirname(ancestor) === ancestor) throw error;
      let exists: boolean;
      try {
        exists = lstatSync(ancestor, { throwIfNoEntry: false }) !== undefined;
      } catch {
        throw error;
      }
      if (exists) throw error;
      missing.push(basename(ancestor));
    }
  }
}

const caseFoldingCache = new Map<string, boolean>();

function flipCase(name: string): string {
  return name.replace(/[a-zA-Z]/g, (c) =>
    c >= 'a' && c <= 'z' ? c.toUpperCase() : c.toLowerCase(),
  );
}

function caseVariantIsSameFile(path: string, variant: string): boolean | null {
  let original: { dev: number; ino: number };
  try {
    original = lstatSync(path);
  } catch {
    return null;
  }
  let other: { dev: number; ino: number };
  try {
    other = lstatSync(variant);
  } catch {
    return false;
  }
  if (original.ino === 0 || other.ino === 0) return null;
  return original.dev === other.dev && original.ino === other.ino;
}

function probeVolumeFoldsCase(path: string): boolean {
  for (let probe = path; ; probe = dirname(probe)) {
    const base = basename(probe);
    const flipped = flipCase(base);
    if (flipped !== base) {
      const verdict = caseVariantIsSameFile(probe, join(dirname(probe), flipped));
      if (verdict !== null) return verdict;
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(probe);
    } catch {}
    for (const name of entries) {
      const variant = flipCase(name);
      if (variant === name) continue;
      const verdict = caseVariantIsSameFile(join(probe, name), join(probe, variant));
      if (verdict !== null) return verdict;
    }
    if (dirname(probe) === probe) return false;
  }
}

function foldsCaseFor(root: string): boolean {
  const key = resolve(root);
  const cached = caseFoldingCache.get(key);
  if (cached !== undefined) return cached;
  const verdict = probeVolumeFoldsCase(key);
  caseFoldingCache.set(key, verdict);
  return verdict;
}

export function samePathOrInside(target: string, root: string): boolean {
  const folds = foldsCaseFor(root);
  const targetCompared = folds ? target.toLowerCase() : target;
  const rootCompared = folds ? root.toLowerCase() : root;
  if (targetCompared === rootCompared) return true;
  const prefix = rootCompared.endsWith(sep) ? rootCompared : rootCompared + sep;
  return targetCompared.startsWith(prefix);
}

export interface CairnSourceRoots {
  skillsDir?: string;
  homeDir?: string;
  dataDir?: string;
  workspacesDir?: string;
  reposDir?: string;
  attachmentsDir?: string;
  logger?: { warn(fields: object, message: string): void };
}

export function assertSourceOutsideCairnDirs(
  real: string,
  source: string,
  roots: CairnSourceRoots,
): void {
  const named: { root: string; name: string; reason: string }[] = [];
  if (roots.skillsDir !== undefined) {
    named.push({
      root: roots.skillsDir,
      name: 'cairn skills directory',
      reason: 'it is already visible to cairn',
    });
  }
  if (roots.homeDir !== undefined) {
    named.push({
      root: roots.homeDir,
      name: 'cairn home directory',
      reason: "it holds cairn's own data",
    });
  }
  if (roots.dataDir !== undefined) {
    named.push({
      root: roots.dataDir,
      name: 'cairn data directory',
      reason: "it holds cairn's own data",
    });
  }
  if (roots.workspacesDir !== undefined) {
    named.push({
      root: roots.workspacesDir,
      name: 'cairn workspaces directory',
      reason: "it holds cairn's own data",
    });
  }
  if (roots.reposDir !== undefined) {
    named.push({
      root: roots.reposDir,
      name: 'cairn repository directory',
      reason: "it holds cairn's own data",
    });
  }
  if (roots.attachmentsDir !== undefined) {
    named.push({
      root: roots.attachmentsDir,
      name: 'cairn attachments directory',
      reason: "it holds cairn's own data",
    });
  }
  for (const { root, name, reason } of named) {
    let rootReal: string;
    try {
      rootReal = realpathOrResolve(root);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new HttpError(
          400,
          `${source} cannot be checked against the ${name} — ${error.message}`,
        );
      }
      throw error;
    }
    if (samePathOrInside(real, rootReal)) {
      roots.logger?.warn({ source, real, root }, 'local source refused inside a cairn directory');
      throw new HttpError(
        400,
        `${source} resolves inside the ${name} — ${reason}; choose a directory outside it`,
      );
    }
    if (samePathOrInside(rootReal, real)) {
      roots.logger?.warn({ source, real, root }, 'local source refused above a cairn directory');
      throw new HttpError(400, `${source} contains the ${name}; choose a directory outside it`);
    }
  }
}
