import semver from 'semver';
import { z } from 'zod';

export const DESKTOP_SHELL_USER_AGENT = 'CairnDesktop/mac';
export const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
export const DESKTOP_RELEASE_MANIFEST = 'desktop-latest.json';
export const DESKTOP_RELEASES_BASE = 'https://github.com/xiechimon/cairn/releases';
export const DESKTOP_MANIFEST_URL = `${DESKTOP_RELEASES_BASE}/latest/download/${DESKTOP_RELEASE_MANIFEST}`;

export type DesktopMenuCommand = 'settings' | 'new-task' | 'search';

export const DESKTOP_TRAY_PATH = '/tray';

export type DesktopRunnerState = 'starting' | 'on' | 'off' | 'failed';

export interface DesktopTrayState {
  runner: DesktopRunnerState;
  keepAwake: boolean;
  newTaskKey: string | null;
}

export type DesktopTrayOpen =
  | { kind: 'path'; path: string }
  | { kind: 'command'; command: DesktopMenuCommand };

export function isAppPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/app(?:[/?]|$)/.test(path);
}

export type DesktopUpdateBlocker = 'development' | 'not-in-applications' | 'read-only';

export type DesktopUpdateState =
  | { status: 'unsupported'; blocker: DesktopUpdateBlocker }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'installing'; version: string }
  | { status: 'restarting'; version: string }
  | { status: 'error'; message: string };

export interface DesktopUpdate {
  version: string;
  url: string;
  size: number;
  sha256: string;
}

const desktopReleaseFileSchema = z.strictObject({
  name: z.string().regex(/^Cairn-[0-9A-Za-z.+-]+\.zip$/),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const desktopReleaseManifestSchema = z.strictObject({
  version: z.string().refine((value) => semver.valid(value) === value, 'not a semver version'),
  files: z.record(z.string(), desktopReleaseFileSchema),
});

export type DesktopReleaseManifest = z.infer<typeof desktopReleaseManifestSchema>;

export function desktopUpdateFrom(
  manifest: DesktopReleaseManifest,
  currentVersion: string,
  arch: string,
): DesktopUpdate | null {
  if (!semver.gt(manifest.version, currentVersion)) return null;
  const file = manifest.files[arch];
  if (file === undefined) return null;
  return {
    version: manifest.version,
    url: `${DESKTOP_RELEASES_BASE}/download/${DESKTOP_RELEASE_TAG_PREFIX}${manifest.version}/${file.name}`,
    size: file.size,
    sha256: file.sha256,
  };
}
