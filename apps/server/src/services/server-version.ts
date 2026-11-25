import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  HOST_UPDATE_REQUEST_FILE,
  HOST_UPDATE_REQUEST_MESSAGE,
  HOST_UPDATE_STATUS_FILE,
  type HostUpdateRequest,
  type HostUpdateStatus,
  hostUpdateRequestSchema,
  hostUpdateStatusSchema,
  type ServerUpdateResponse,
  type ServerUpdateState,
  type ServerUpdateStatus,
  type ServerVersionResponse,
} from '@cairn/shared';
import { pidAlive } from '@cairn/shared/parent-watch';
import { eq, isNotNull } from 'drizzle-orm';
import { SERVER_BUILD_COMMIT, SERVER_BUILD_VERSION } from '../build-info.js';
import type { Db } from '../db/client.js';
import { chiefThread, step } from '../db/schema.js';
import { isLaunchdManaged } from '../server-owner.js';
import { readDeployStatus } from './deploy-status.js';

const execFileAsync = promisify(execFile);

const UPDATER_LABEL = 'app.cairn.updater';
const ACTIVE_UPDATE_STATES: ReadonlySet<ServerUpdateState> = new Set([
  'checking',
  'downloading',
  'waiting-idle',
  'installing',
  'restarting',
]);
export const HOST_UPDATE_STALE_MS = 10 * 60_000;
export const HOST_UPDATE_WAITING_IDLE_STALE_MS = 24 * 60 * 60_000;
export const HOST_UPDATE_COOLDOWN_MS = 30_000;

export interface HostUpdateContext {
  trigger?: (request: HostUpdateRequest) => Promise<void>;
  now?: () => number;
}

interface ParentPortLike {
  postMessage(message: unknown): void;
}

function cleanEnvValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readBundleShortVersion(execPath: string): string | null {
  const marker = '.app/';
  const index = execPath.indexOf(marker);
  if (index === -1) return null;
  const appPath = execPath.slice(0, index + 4);
  try {
    const plist = readFileSync(join(appPath, 'Contents', 'Info.plist'), 'utf8');
    const key = '<key>CFBundleShortVersionString</key>';
    const at = plist.indexOf(key);
    if (at === -1) return null;
    const match = /^\s*<string>([^<]+)<\/string>/.exec(plist.slice(at + key.length));
    const version = match?.[1]?.trim() ?? '';
    return version !== '' && version !== '0.0.0' ? version : null;
  } catch {
    return null;
  }
}

let cachedPackageVersion: string | null | undefined;

function readServerPackageVersion(): string | null {
  if (cachedPackageVersion !== undefined) return cachedPackageVersion;
  try {
    const here = resolve(fileURLToPath(import.meta.url), '../../..');
    const raw = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    cachedPackageVersion = version !== '' && version !== '0.0.0' ? version : null;
  } catch {
    cachedPackageVersion = null;
  }
  return cachedPackageVersion;
}

export function readServerVersionInfo(opts: {
  env?: NodeJS.ProcessEnv;
  deployRecordPath?: string;
  execPath?: string;
}): { version: string | null; commit: string | null } {
  const env = opts.env ?? process.env;
  const envVersion = cleanEnvValue(env.CAIRN_SERVER_VERSION);
  const envCommit = cleanEnvValue(env.CAIRN_SERVER_COMMIT);
  const version =
    envVersion ??
    SERVER_BUILD_VERSION ??
    readBundleShortVersion(opts.execPath ?? process.execPath) ??
    readServerPackageVersion();
  const deploySha = readDeployStatus(opts.deployRecordPath).deployed?.sha ?? null;
  const rawCommit = envCommit ?? SERVER_BUILD_COMMIT ?? deploySha;
  const commit = rawCommit === null ? null : rawCommit.slice(0, 7);
  return { version, commit };
}

export function isServerBusy(db: Db): boolean {
  const activeTurn = db
    .select({ id: chiefThread.id })
    .from(chiefThread)
    .where(isNotNull(chiefThread.activeRun))
    .limit(1)
    .get();
  if (activeTurn !== undefined) return true;
  const claimedStep = db
    .select({ id: step.id })
    .from(step)
    .where(eq(step.status, 'claimed'))
    .limit(1)
    .get();
  return claimedStep !== undefined;
}

function updaterPlistPath(env: NodeJS.ProcessEnv): string {
  const override = cleanEnvValue(env.CAIRN_UPDATER_PLIST);
  if (override !== null) return override;
  return join(homedir(), 'Library', 'LaunchAgents', `${UPDATER_LABEL}.plist`);
}

function hasLaunchdUpdater(env: NodeJS.ProcessEnv): boolean {
  return isLaunchdManaged(env) && existsSync(updaterPlistPath(env));
}

function readRawHostUpdateStatus(homeDir: string): HostUpdateStatus | null {
  const path = join(homeDir, HOST_UPDATE_STATUS_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = hostUpdateStatusSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? (parsed.data as HostUpdateStatus) : null;
  } catch {
    return null;
  }
}

export function readHostUpdateRequest(homeDir: string): HostUpdateRequest | null {
  const path = join(homeDir, HOST_UPDATE_REQUEST_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = hostUpdateRequestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeHostUpdateRequest(homeDir: string, request: HostUpdateRequest): void {
  const path = join(homeDir, HOST_UPDATE_REQUEST_FILE);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}

const UNSUPPORTED_NO_UPDATER: ServerUpdateStatus = {
  supported: false,
  state: 'unsupported',
  targetVersion: null,
  percent: null,
  reason: 'no-updater',
  updatedAt: null,
};

export function readHostUpdateStatus(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): ServerUpdateStatus {
  const raw = readRawHostUpdateStatus(homeDir);
  if (raw !== null) {
    const waitingIdleAgent =
      raw.kind === 'background-agent' &&
      raw.state === 'waiting-idle' &&
      hasLaunchdUpdater(env) &&
      now - raw.updatedAt <= HOST_UPDATE_WAITING_IDLE_STALE_MS;
    const staleActive =
      ACTIVE_UPDATE_STATES.has(raw.state) &&
      !waitingIdleAgent &&
      (!pidAlive(raw.pid) || now - raw.updatedAt > HOST_UPDATE_STALE_MS);
    if (staleActive) {
      if (raw.kind === 'desktop' && !pidAlive(raw.pid)) {
        if (hasLaunchdUpdater(env)) {
          return {
            supported: true,
            state: 'idle',
            targetVersion: null,
            percent: null,
            reason: null,
            updatedAt: raw.updatedAt,
          };
        }
        return {
          supported: raw.supported,
          state: raw.supported ? 'idle' : 'unsupported',
          targetVersion: null,
          percent: null,
          reason: raw.supported ? null : (raw.reason ?? 'no-updater'),
          updatedAt: raw.updatedAt,
        };
      }
      return {
        supported: raw.supported,
        state: raw.supported ? 'idle' : 'unsupported',
        targetVersion: null,
        percent: null,
        reason: raw.supported ? null : (raw.reason ?? 'no-updater'),
        updatedAt: raw.updatedAt,
      };
    }
    if (raw.kind === 'desktop' && !pidAlive(raw.pid) && hasLaunchdUpdater(env)) {
      return {
        supported: true,
        state: 'idle',
        targetVersion: null,
        percent: null,
        reason: null,
        updatedAt: raw.updatedAt,
      };
    }
    return {
      supported: raw.supported,
      state: raw.state,
      targetVersion: raw.targetVersion,
      percent: raw.percent,
      reason: raw.reason,
      updatedAt: raw.updatedAt,
    };
  }
  if (hasLaunchdUpdater(env)) {
    return {
      supported: true,
      state: 'idle',
      targetVersion: null,
      percent: null,
      reason: null,
      updatedAt: null,
    };
  }
  return UNSUPPORTED_NO_UPDATER;
}

export function buildServerVersionResponse(opts: {
  db: Db;
  homeDir: string;
  deployRecordPath?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
}): ServerVersionResponse {
  const { version, commit } = readServerVersionInfo({
    env: opts.env,
    deployRecordPath: opts.deployRecordPath,
  });
  return {
    version,
    commit,
    busy: isServerBusy(opts.db),
    updater: readHostUpdateStatus(opts.homeDir, opts.env, opts.now),
  };
}

async function defaultTriggerHostUpdate(
  request: HostUpdateRequest,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
  if (parentPort !== undefined) {
    parentPort.postMessage({
      type: HOST_UPDATE_REQUEST_MESSAGE,
      id: request.id,
      requestedVersion: request.requestedVersion,
    });
    return;
  }
  if (process.platform === 'darwin' && hasLaunchdUpdater(env)) {
    const uid = process.getuid?.() ?? 501;
    await execFileAsync('launchctl', ['kickstart', `gui/${uid}/${UPDATER_LABEL}`]);
  }
}

export async function requestHostUpdate(opts: {
  homeDir: string;
  targetVersion?: string;
  env?: NodeJS.ProcessEnv;
  hostUpdate?: HostUpdateContext;
}): Promise<ServerUpdateResponse> {
  const env = opts.env ?? process.env;
  const now = opts.hostUpdate?.now?.() ?? Date.now();
  const updater = readHostUpdateStatus(opts.homeDir, env, now);
  if (!updater.supported) {
    return { accepted: false, updater };
  }
  if (ACTIVE_UPDATE_STATES.has(updater.state)) {
    return { accepted: true, updater };
  }
  const existingRequest = readHostUpdateRequest(opts.homeDir);
  if (
    existingRequest !== null &&
    now - existingRequest.requestedAt < HOST_UPDATE_COOLDOWN_MS &&
    updater.state !== 'failed' &&
    updater.state !== 'up-to-date'
  ) {
    return { accepted: true, updater };
  }
  const request: HostUpdateRequest = {
    id: randomUUID(),
    requestedVersion: opts.targetVersion ?? null,
    requestedAt: now,
  };
  writeHostUpdateRequest(opts.homeDir, request);
  const trigger =
    opts.hostUpdate?.trigger ?? ((req: HostUpdateRequest) => defaultTriggerHostUpdate(req, env));
  await trigger(request);
  return {
    accepted: true,
    updater: {
      ...updater,
      state: 'checking',
      targetVersion: request.requestedVersion ?? updater.targetVersion,
      reason: null,
      updatedAt: now,
    },
  };
}

let lastIdleRetriggerAt = 0;

export async function maybeRetriggerIdleHostUpdate(opts: {
  db: Db;
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  hostUpdate?: HostUpdateContext;
}): Promise<boolean> {
  const env = opts.env ?? process.env;
  const now = opts.hostUpdate?.now?.() ?? Date.now();
  if (now - lastIdleRetriggerAt < HOST_UPDATE_COOLDOWN_MS) return false;
  const status = readHostUpdateStatus(opts.homeDir, env, now);
  if (!status.supported || status.state !== 'waiting-idle') return false;
  if (isServerBusy(opts.db)) return false;
  const existing = readHostUpdateRequest(opts.homeDir);
  if (existing === null) return false;
  lastIdleRetriggerAt = now;
  const trigger =
    opts.hostUpdate?.trigger ?? ((req: HostUpdateRequest) => defaultTriggerHostUpdate(req, env));
  await trigger(existing);
  return true;
}
