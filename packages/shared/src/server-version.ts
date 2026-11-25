import semver from 'semver';
import { z } from 'zod';
import type { DesktopUpdateBlocker } from './desktop-shell.js';

export const HOST_UPDATE_REQUEST_FILE = 'host-update-request.json';
export const HOST_UPDATE_STATUS_FILE = 'host-update-status.json';
export const HOST_UPDATE_REQUEST_MESSAGE = 'cairn:host-update-request';

export const serverUpdateStateSchema = z.enum([
  'idle',
  'checking',
  'downloading',
  'waiting-idle',
  'installing',
  'restarting',
  'up-to-date',
  'unsupported',
  'failed',
]);
export type ServerUpdateState = z.infer<typeof serverUpdateStateSchema>;

export const serverUpdateReasonSchema = z.enum([
  'no-updater',
  'development',
  'not-in-applications',
  'read-only',
  'low-battery',
  'blocked',
  'offline',
  'no-release',
  'signature-refused',
  'failed',
]);
export type ServerUpdateReason = z.infer<typeof serverUpdateReasonSchema>;

export const serverUpdateStatusSchema = z.strictObject({
  supported: z.boolean(),
  state: serverUpdateStateSchema,
  targetVersion: z.string().min(1).nullable(),
  percent: z.number().min(0).max(100).nullable(),
  reason: serverUpdateReasonSchema.nullable(),
  updatedAt: z.number().int().nonnegative().nullable(),
});
export type ServerUpdateStatus = z.infer<typeof serverUpdateStatusSchema>;

export const serverVersionResponseSchema = z.strictObject({
  version: z.string().min(1).nullable(),
  commit: z.string().min(1).max(64).nullable(),
  busy: z.boolean(),
  updater: serverUpdateStatusSchema,
});
export type ServerVersionResponse = z.infer<typeof serverVersionResponseSchema>;

export const serverUpdateRequestBodySchema = z.strictObject({
  targetVersion: z
    .string()
    .refine((value) => semver.valid(value) === value, 'not a semver version')
    .optional(),
});
export type ServerUpdateRequestBody = z.infer<typeof serverUpdateRequestBodySchema>;

export const serverUpdateResponseSchema = z.strictObject({
  accepted: z.boolean(),
  updater: serverUpdateStatusSchema,
});
export type ServerUpdateResponse = z.infer<typeof serverUpdateResponseSchema>;

export const hostUpdateRequestSchema = z.strictObject({
  id: z.string().min(1).max(128),
  requestedVersion: z.string().min(1).nullable(),
  requestedAt: z.number().int().nonnegative(),
});
export type HostUpdateRequest = z.infer<typeof hostUpdateRequestSchema>;

const desktopUpdateBlockerSchema = z.enum(['development', 'not-in-applications', 'read-only']);

export const hostUpdateStatusSchema = z.strictObject({
  pid: z.number().int().positive(),
  kind: z.enum(['desktop', 'background-agent']),
  supported: z.boolean(),
  blocker: desktopUpdateBlockerSchema.nullable(),
  state: serverUpdateStateSchema,
  targetVersion: z.string().min(1).nullable(),
  percent: z.number().min(0).max(100).nullable(),
  reason: serverUpdateReasonSchema.nullable(),
  handledRequestId: z.string().min(1).nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type HostUpdateStatus = z.infer<typeof hostUpdateStatusSchema> & {
  blocker: DesktopUpdateBlocker | null;
};

export const remoteVersionPhaseSchema = z.enum([
  'local',
  'probing',
  'awaiting-auth',
  'current',
  'updating',
  'restarting',
  'reloading',
  'old-server',
  'unsupported',
  'failed',
]);
export type RemoteVersionPhase = z.infer<typeof remoteVersionPhaseSchema>;

export const remoteVersionStateSchema = z.strictObject({
  phase: remoteVersionPhaseSchema,
  serverVersion: z.string().min(1).nullable(),
  serverCommit: z.string().min(1).nullable(),
  appVersion: z.string().min(1),
  targetVersion: z.string().min(1).nullable(),
  updaterState: serverUpdateStateSchema.nullable(),
  percent: z.number().min(0).max(100).nullable(),
  reason: serverUpdateReasonSchema.nullable(),
});
export type RemoteVersionState = z.infer<typeof remoteVersionStateSchema>;

export function isServerVersionNewer(next: string | null, previous: string | null): boolean {
  if (next === null || previous === null) return false;
  const parsedNext = semver.valid(next);
  const parsedPrevious = semver.valid(previous);
  if (parsedNext !== null && parsedPrevious !== null) return semver.gt(parsedNext, parsedPrevious);
  return next !== previous;
}

export function isRemoteServerOlder(serverVersion: string | null, appVersion: string): boolean {
  if (serverVersion === null) return false;
  const parsedServer = semver.valid(serverVersion);
  const parsedApp = semver.valid(appVersion);
  if (parsedServer === null || parsedApp === null) return false;
  if (parsedApp === '0.0.0') return false;
  return semver.lt(parsedServer, parsedApp);
}
