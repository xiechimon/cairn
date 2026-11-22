import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { compareVersions } from '../antigravity-local.js';

export function insidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export interface VerifiedManagedBin {
  command: string;
  args: string[];
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
    if (marker.binRelPath.startsWith('/') || marker.binRelPath.split(/[/\\]/).includes('..')) {
      return null;
    }
    if (typeof marker.binSha256 !== 'string') return null;
    const command = join(versionDir, marker.binRelPath);
    if (!insidePath(realpathSync(versionDir), realpathSync(command))) return null;
    const digest = createHash('sha256').update(readFileSync(command)).digest('hex');
    if (digest !== marker.binSha256.toLowerCase()) return null;
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
