import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { compareVersions } from '../antigravity-local.js';
import { compareManagedVersions } from '../records/model-source.js';

export function insidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export interface VerifiedManagedBin {
  command: string;
  args: string[];
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function unsafeManagedVersion(version: string): boolean {
  return version === '' || /[/\\]/.test(version) || version.startsWith('.');
}

export function verifiedManagedBin(versionDir: string): VerifiedManagedBin | null {
  try {
    const marker = JSON.parse(readFileSync(join(versionDir, '.install-complete'), 'utf8')) as {
      binRelPath?: unknown;
      binSha256?: unknown;
      args?: unknown;
    };
    if (typeof marker.binRelPath !== 'string' || marker.binRelPath === '') return null;
    if (
      isAbsolute(marker.binRelPath) ||
      marker.binRelPath.startsWith('/') ||
      marker.binRelPath.startsWith('\\') ||
      marker.binRelPath.split(/[/\\]/).includes('..')
    ) {
      return null;
    }
    if (typeof marker.binSha256 !== 'string') return null;
    const command = join(versionDir, marker.binRelPath);
    if (!insidePath(realpathSync(versionDir), realpathSync(command))) return null;
    if (sha256File(command) !== marker.binSha256.toLowerCase()) return null;
    const args =
      Array.isArray(marker.args) && marker.args.every((arg) => typeof arg === 'string')
        ? marker.args
        : [];
    return { command, args };
  } catch {
    return null;
  }
}

export function verifiedManagedBins(
  versionsDir: string,
  versions: readonly string[],
): VerifiedManagedBin[] {
  return [...versions]
    .sort((a, b) => compareVersions(b, a))
    .flatMap((version) => {
      const found = verifiedManagedBin(join(versionsDir, version));
      return found === null ? [] : [found];
    });
}

export interface ActiveManagedBin extends VerifiedManagedBin {
  version: string;
  versionDir: string;
}

export function activeManagedBin(root: string): ActiveManagedBin | null {
  try {
    const pointer = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof pointer.version === 'string' && !unsafeManagedVersion(pointer.version)) {
      const versionDir = join(root, 'versions', pointer.version);
      const found = verifiedManagedBin(versionDir);
      if (found !== null) return { ...found, version: pointer.version, versionDir };
    }
  } catch {}
  const versionsDir = join(root, 'versions');
  try {
    const versions = readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !unsafeManagedVersion(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => compareManagedVersions(b, a));
    for (const version of versions) {
      const versionDir = join(versionsDir, version);
      const found = verifiedManagedBin(versionDir);
      if (found !== null) return { ...found, version, versionDir };
    }
  } catch {}
  return null;
}
