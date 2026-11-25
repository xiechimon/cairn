import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type DesktopUpdateState,
  HOST_UPDATE_REQUEST_FILE,
  HOST_UPDATE_STATUS_FILE,
  type HostUpdateRequest,
  type HostUpdateStatus,
  hostUpdateRequestSchema,
  hostUpdateStatusSchema,
  isRemoteServerOlder,
} from '@cairn/shared';
import { SIGNATURE_REFUSAL } from './update-core.js';

export function readHostUpdateRequest(cairnHome: string): HostUpdateRequest | null {
  const path = join(cairnHome, HOST_UPDATE_REQUEST_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = hostUpdateRequestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function initialHandledHostRequestId(cairnHome: string): string | null {
  const path = join(cairnHome, HOST_UPDATE_STATUS_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = hostUpdateStatusSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data.handledRequestId : null;
  } catch {
    return null;
  }
}

export function shouldHandleHostUpdateRequest(
  request: HostUpdateRequest,
  opts: { appVersion: string; handledRequestId: string | null },
): boolean {
  if (request.id === opts.handledRequestId) return false;
  if (
    request.requestedVersion !== null &&
    !isRemoteServerOlder(opts.appVersion, request.requestedVersion)
  ) {
    return false;
  }
  return true;
}

export function writeHostUpdateStatus(cairnHome: string, status: HostUpdateStatus): void {
  const path = join(cairnHome, HOST_UPDATE_STATUS_FILE);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

export function desktopStateToHostStatus(
  state: DesktopUpdateState,
  opts: {
    pid?: number;
    handledRequestId: string | null;
    now?: number;
  },
): HostUpdateStatus {
  const base = {
    pid: opts.pid ?? process.pid,
    kind: 'desktop' as const,
    handledRequestId: opts.handledRequestId,
    updatedAt: opts.now ?? Date.now(),
  };
  switch (state.status) {
    case 'unsupported':
      return {
        ...base,
        supported: false,
        blocker: state.blocker,
        state: 'unsupported',
        targetVersion: null,
        percent: null,
        reason: state.blocker,
      };
    case 'idle':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'idle',
        targetVersion: null,
        percent: null,
        reason: null,
      };
    case 'checking':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'checking',
        targetVersion: null,
        percent: null,
        reason: null,
      };
    case 'current':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'up-to-date',
        targetVersion: null,
        percent: null,
        reason: opts.handledRequestId !== null ? 'no-release' : null,
      };
    case 'available':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'checking',
        targetVersion: state.version,
        percent: null,
        reason: null,
      };
    case 'downloading':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'downloading',
        targetVersion: state.version,
        percent: Math.round(state.percent),
        reason: null,
      };
    case 'ready':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'waiting-idle',
        targetVersion: state.version,
        percent: 100,
        reason: null,
      };
    case 'installing':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'installing',
        targetVersion: state.version,
        percent: 100,
        reason: null,
      };
    case 'restarting':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'restarting',
        targetVersion: state.version,
        percent: 100,
        reason: null,
      };
    case 'offline':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'failed',
        targetVersion: null,
        percent: null,
        reason: 'offline',
      };
    case 'error':
      return {
        ...base,
        supported: true,
        blocker: null,
        state: 'failed',
        targetVersion: null,
        percent: null,
        reason: state.message === SIGNATURE_REFUSAL ? 'signature-refused' : 'failed',
      };
  }
}
