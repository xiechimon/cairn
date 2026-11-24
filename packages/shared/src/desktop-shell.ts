import semver from 'semver';
import { z } from 'zod';

export const DESKTOP_SHELL_USER_AGENT = 'CairnDesktop/mac';
export const DESKTOP_RELEASE_TAG_PREFIX = 'desktop-v';
export const DESKTOP_RELEASE_MANIFEST = 'desktop-latest.json';
export const DESKTOP_RELEASES_BASE = 'https://github.com/xiechimon/cairn/releases';
export const DESKTOP_MANIFEST_URL = `${DESKTOP_RELEASES_BASE}/latest/download/${DESKTOP_RELEASE_MANIFEST}`;

const DESKTOP_MENU_COMMANDS = ['settings', 'new-task', 'search'] as const;

export type DesktopMenuCommand = (typeof DESKTOP_MENU_COMMANDS)[number];

export const DESKTOP_TRAY_PATH = '/tray';

export type DesktopRunnerState = 'starting' | 'on' | 'off' | 'failed';

export interface DesktopTrayState {
  runner: DesktopRunnerState;
  keepAwake: boolean;
  accent: string | null;
}

export type DesktopTrayOpen =
  | { kind: 'path'; path: string }
  | { kind: 'command'; command: DesktopMenuCommand };

export function isAppPath(path: unknown): path is string {
  return typeof path === 'string' && /^\/app(?:[/?]|$)/.test(path);
}

const desktopTrayOpenSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('path'),
    path: z.string().refine(isAppPath, 'not an app path'),
  }),
  z.strictObject({ kind: z.literal('command'), command: z.enum(DESKTOP_MENU_COMMANDS) }),
]);

const trayText = z.string().max(500);

export const NATIVE_TRAY_GLYPHS = [
  'todo',
  'queued',
  'ring',
  'working',
  'progress',
  'attention',
  'quarter',
  'half',
  'three-quarter',
  'done',
  'failed',
  'closed',
] as const;

export const nativeTrayItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('row'),
    id: z.string().min(1).max(200),
    title: trayText,
    status: trayText.optional(),
    tip: trayText.optional(),
    glyph: z.enum(NATIVE_TRAY_GLYPHS).optional(),
    image: z.enum(['brand', 'usage', 'user']).optional(),
    warn: z.boolean().optional(),
    open: desktopTrayOpenSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('header'),
    id: z.string().min(1).max(200),
    title: trayText,
    reading: z
      .strictObject({
        parts: z
          .array(z.strictObject({ text: trayText, strained: z.boolean() }))
          .min(1)
          .max(6),
        faint: z.boolean(),
        spoken: trayText,
        tip: trayText,
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('switch'),
    id: z.enum(['runner', 'keep-awake']),
    title: trayText,
    detail: trayText.optional(),
    warn: z.boolean().optional(),
    on: z.boolean(),
    enabled: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('command'),
    id: z.enum(['settings', 'quit']),
    title: trayText,
    key: z.string().max(1),
  }),
  z.strictObject({ kind: z.literal('separator'), id: z.string().min(1).max(200) }),
]);

export const nativeTrayMenuSchema = z.strictObject({
  label: trayText,
  items: z.array(nativeTrayItemSchema).max(200),
});

export type NativeTrayItem = z.infer<typeof nativeTrayItemSchema>;
export type NativeTrayMenu = z.infer<typeof nativeTrayMenuSchema>;

export interface DesktopNotifyDialog {
  title: string;
  detail: string;
}

export interface DesktopNotifyPayload {
  title: string;
  body: string;
  href: string;
  tag: string;
  dialog?: DesktopNotifyDialog;
}

function isDesktopNotifyDialog(value: unknown): value is DesktopNotifyDialog {
  if (typeof value !== 'object' || value === null) return false;
  const dialog = value as Partial<Record<keyof DesktopNotifyDialog, unknown>>;
  return (
    typeof dialog.title === 'string' &&
    dialog.title !== '' &&
    dialog.title.length <= 200 &&
    typeof dialog.detail === 'string' &&
    dialog.detail !== '' &&
    dialog.detail.length <= 500
  );
}

export function isDesktopNotifyPayload(value: unknown): value is DesktopNotifyPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<Record<keyof DesktopNotifyPayload, unknown>>;
  return (
    typeof payload.title === 'string' &&
    payload.title !== '' &&
    payload.title.length <= 200 &&
    typeof payload.body === 'string' &&
    payload.body.length <= 500 &&
    isAppPath(payload.href) &&
    typeof payload.tag === 'string' &&
    payload.tag.length <= 100 &&
    (payload.dialog === undefined || isDesktopNotifyDialog(payload.dialog))
  );
}

export interface DesktopRollbackNotice {
  failedVersion: string;
  restoredVersion: string;
  logPath: string;
}

export interface DesktopNotificationOptions {
  title: string;
  body: string;
  silent: boolean;
}

export function desktopNotificationOptions(
  payload: DesktopNotifyPayload,
): DesktopNotificationOptions {
  return { title: payload.title, body: payload.body, silent: false };
}

export type DesktopUpdateBlocker = 'development' | 'not-in-applications' | 'read-only';

export type DesktopUpdateState =
  | { status: 'unsupported'; blocker: DesktopUpdateBlocker }
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'installing'; version: string }
  | { status: 'restarting'; version: string }
  | { status: 'offline' }
  | { status: 'error'; message: string };

export interface DesktopUpdate {
  version: string;
  url: string;
  size: number;
  sha256: string;
}

const desktopReleaseFileSchema = z.strictObject({
  name: z.string().regex(/^Cairn-[0-9A-Za-z.+-]+\.(zip|exe)$/),
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
  platform: string = 'darwin',
): DesktopUpdate | null {
  if (!semver.gt(manifest.version, currentVersion)) return null;
  const key = platform === 'win32' ? `win-${arch}` : arch;
  const file = manifest.files[key];
  if (file === undefined) return null;
  return {
    version: manifest.version,
    url: `${DESKTOP_RELEASES_BASE}/download/${DESKTOP_RELEASE_TAG_PREFIX}${manifest.version}/${file.name}`,
    size: file.size,
    sha256: file.sha256,
  };
}
