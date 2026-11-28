import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const UPDATE_STATE_FILE = 'update-state.json';

export interface StagedUpdate {
  version: string;
  zip: string;
  app: string;
  previousVersion: string;
  at: number;
}

export type UpdateGuardOwner = 'desktop' | 'background-agent';

export interface InstalledUpdate {
  version: string;
  previousVersion: string;
  previousApp: string;
  at: number;
  guardOwner?: UpdateGuardOwner | null;
  guardPid?: number | null;
  attemptId?: string | null;
  dbSnapshot?: string | null;
}

export interface BlockedUpdate {
  version: string;
  at: number;
  reason: string;
  attempts: number;
}

export interface UpdateNotice {
  failedVersion: string;
  restoredVersion: string;
  reason: string;
  logPath: string;
  at: number;
}

export interface RepairReplacement {
  version: string;
  attemptId: string;
}

export interface RepairHold {
  attemptId: string;
  failedVersion: string;
  previousVersion: string;
  pinnedApp: string;
  pinnedSnapshot: string | null;
  reason: string;
  at: number;
  replacement: RepairReplacement | null;
}

export interface UpdateState {
  staged: StagedUpdate | null;
  installed: InstalledUpdate | null;
  blocked: BlockedUpdate | null;
  notice: UpdateNotice | null;
  knownVersion: string | null;
  repair?: RepairHold | null;
}

export function updateStatePath(userData: string): string {
  return join(userData, UPDATE_STATE_FILE);
}

export function emptyUpdateState(): UpdateState {
  return { staged: null, installed: null, blocked: null, notice: null, knownVersion: null };
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function field<T>(value: unknown, read: (row: Record<string, unknown>) => T | null): T | null {
  if (typeof value !== 'object' || value === null) return null;
  return read(value as Record<string, unknown>);
}

export function parseUpdateState(text: string): UpdateState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyUpdateState();
  }
  if (typeof raw !== 'object' || raw === null) return emptyUpdateState();
  const rows = raw as Record<string, unknown>;
  const staged = field(rows.staged, (row) =>
    isText(row.version) &&
    isText(row.zip) &&
    isText(row.app) &&
    isText(row.previousVersion) &&
    isTime(row.at)
      ? {
          version: row.version,
          zip: row.zip,
          app: row.app,
          previousVersion: row.previousVersion,
          at: row.at,
        }
      : null,
  );
  const installed = field<InstalledUpdate>(rows.installed, (row): InstalledUpdate | null =>
    isText(row.version) && isText(row.previousVersion) && isText(row.previousApp) && isTime(row.at)
      ? {
          version: row.version,
          previousVersion: row.previousVersion,
          previousApp: row.previousApp,
          at: row.at,
          ...(row.guardOwner === 'desktop' || row.guardOwner === 'background-agent'
            ? { guardOwner: row.guardOwner as UpdateGuardOwner }
            : row.guardOwner === null
              ? { guardOwner: null }
              : {}),
          ...(typeof row.guardPid === 'number' && Number.isInteger(row.guardPid) && row.guardPid > 0
            ? { guardPid: row.guardPid }
            : row.guardPid === null
              ? { guardPid: null }
              : {}),
          ...(isText(row.attemptId)
            ? { attemptId: row.attemptId }
            : row.attemptId === null
              ? { attemptId: null }
              : {}),
          ...(isText(row.dbSnapshot)
            ? { dbSnapshot: row.dbSnapshot }
            : row.dbSnapshot === null
              ? { dbSnapshot: null }
              : {}),
        }
      : null,
  );
  const blocked = field(rows.blocked, (row) =>
    isText(row.version) && isText(row.reason) && isTime(row.at)
      ? {
          version: row.version,
          at: row.at,
          reason: row.reason,
          attempts: isTime(row.attempts) ? row.attempts : 1,
        }
      : null,
  );
  const notice = field(rows.notice, (row) =>
    isText(row.failedVersion) &&
    isText(row.restoredVersion) &&
    isText(row.reason) &&
    isText(row.logPath) &&
    isTime(row.at)
      ? {
          failedVersion: row.failedVersion,
          restoredVersion: row.restoredVersion,
          reason: row.reason,
          logPath: row.logPath,
          at: row.at,
        }
      : null,
  );
  const knownVersion = isText(rows.knownVersion) ? rows.knownVersion : null;
  const repair = field<RepairHold>(rows.repair, (row) =>
    isText(row.attemptId) &&
    isText(row.failedVersion) &&
    isText(row.previousVersion) &&
    isText(row.pinnedApp) &&
    isText(row.reason) &&
    isTime(row.at)
      ? {
          attemptId: row.attemptId,
          failedVersion: row.failedVersion,
          previousVersion: row.previousVersion,
          pinnedApp: row.pinnedApp,
          pinnedSnapshot: isText(row.pinnedSnapshot) ? row.pinnedSnapshot : null,
          reason: row.reason,
          at: row.at,
          replacement: field<RepairReplacement>(row.replacement, (found) =>
            isText(found.version) && isText(found.attemptId)
              ? { version: found.version, attemptId: found.attemptId }
              : null,
          ),
        }
      : null,
  );
  return {
    staged,
    installed,
    blocked,
    notice,
    knownVersion,
    ...(repair === null ? {} : { repair }),
  };
}

export function readUpdateState(path: string): UpdateState {
  try {
    return parseUpdateState(readFileSync(path, 'utf8'));
  } catch {
    return emptyUpdateState();
  }
}

export function writeUpdateState(path: string, state: UpdateState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

export function isAutoInstallBlocked(state: UpdateState, version: string): boolean {
  return state.blocked !== null && state.blocked.version === version;
}

export function shouldStage(state: UpdateState, version: string): boolean {
  return state.staged === null && !isAutoInstallBlocked(state, version);
}

export function stagedFor(state: UpdateState, runningVersion: string): StagedUpdate | null {
  const staged = state.staged;
  if (staged === null || staged.previousVersion !== runningVersion) return null;
  return staged;
}

export function isStaleInstall(state: UpdateState, runningVersion: string): boolean {
  return state.installed !== null && state.installed.version !== runningVersion;
}
