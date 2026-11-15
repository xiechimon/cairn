import semver from 'semver';
import { z } from 'zod';

export const DESKTOP_SHELL_USER_AGENT = 'CairnDesktop/mac';
export const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
export const DESKTOP_RELEASES_URL =
  'https://api.github.com/repos/xiechimon/cairn/releases?per_page=30';

export type DesktopUpdateBlocker = 'development' | 'not-in-applications' | 'read-only';

export type DesktopUpdateState =
  | { status: 'unsupported'; blocker: DesktopUpdateBlocker }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'installing'; version: string }
  | { status: 'error'; message: string };

export interface DesktopUpdate {
  version: string;
  url: string;
  size: number;
  sha256: string;
}

const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/;

const desktopReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.url(),
      size: z.number().int().positive(),
      digest: z.string().nullish(),
    }),
  ),
});

export const desktopReleasesSchema = z.array(desktopReleaseSchema);

export function newestDesktopUpdate(
  releases: z.infer<typeof desktopReleasesSchema>,
  currentVersion: string,
  arch: string,
): DesktopUpdate | null {
  let newest: DesktopUpdate | null = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    if (!release.tag_name.startsWith(DESKTOP_RELEASE_TAG_PREFIX)) continue;
    const version = semver.valid(release.tag_name.slice(DESKTOP_RELEASE_TAG_PREFIX.length));
    if (version === null || !semver.gt(version, currentVersion)) continue;
    if (newest !== null && !semver.gt(version, newest.version)) continue;
    const asset = release.assets.find(
      (candidate) => candidate.name === `Cairn-${version}-${arch}.zip`,
    );
    const sha256 = SHA256_DIGEST.exec(asset?.digest ?? '')?.[1];
    if (asset === undefined || sha256 === undefined) continue;
    newest = { version, url: asset.browser_download_url, size: asset.size, sha256 };
  }
  return newest;
}
