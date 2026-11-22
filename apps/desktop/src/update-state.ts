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

export interface InstalledUpdate {
  version: string;
  previousVersion: string;
  previousApp: string;
  at: number;
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

export interface UpdateState {
  staged: StagedUpdate | null;
  installed: InstalledUpdate | null;
  blocked: BlockedUpdate | null;
  notice: UpdateNotice | null;
}

export function updateStatePath(userData: string): string {
  return join(userData, UPDATE_STATE_FILE);
}

export function emptyUpdateState(): UpdateState {
  return { staged: null, installed: null, blocked: null, notice: null };
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
  const installed = field(rows.installed, (row) =>
    isText(row.version) && isText(row.previousVersion) && isText(row.previousApp) && isTime(row.at)
      ? {
          version: row.version,
          previousVersion: row.previousVersion,
          previousApp: row.previousApp,
          at: row.at,
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
  return { staged, installed, blocked, notice };
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

function releaseNumbers(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(offered: string, staged: string): boolean {
  const left = releaseNumbers(offered);
  const right = releaseNumbers(staged);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

export function shouldStage(state: UpdateState, version: string): boolean {
  if (isAutoInstallBlocked(state, version)) return false;
  const staged = state.staged;
  return staged === null || isNewerVersion(version, staged.version);
}

export function stagedFor(state: UpdateState, runningVersion: string): StagedUpdate | null {
  const staged = state.staged;
  if (staged === null || staged.previousVersion !== runningVersion) return null;
  return staged;
}

export function isStaleInstall(state: UpdateState, runningVersion: string): boolean {
  return state.installed !== null && state.installed.version !== runningVersion;
}
