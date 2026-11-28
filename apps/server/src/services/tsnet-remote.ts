import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import type { TailnetAccess, TailnetErrorKind } from '@cairn/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { TsnetSettings } from '../config.js';
import { listenOnTailnetSocket, type TailnetListener } from '../lib/tailnet-listener.js';
import {
  type SidecarLogger,
  type SidecarStatus,
  type SidecarSupervisor,
  type SpawnSidecar,
  superviseSidecar,
} from '../lib/tsnet-sidecar.js';

const TSNET_DIR_NAME = 'tsnet';
const SOCKET_FILE_NAME = 'tailnet.sock';
const PRIVATE_DIR_MODE = 0o700;
const GROUP_AND_OTHER_BITS = 0o077;
const MAX_SOCKET_PATH_BYTES = 103;

export interface TsnetPaths {
  root: string;
  stateDir: string;
  socketPath: string;
}

export interface TsnetRemote {
  status(): SidecarStatus;
  stop(): Promise<void>;
}

export interface StartTsnetRemoteInput {
  settings: TsnetSettings;
  homeDir: string;
  app: Hono;
  authToken: string | null;
  logger: SidecarLogger;
  parentEnv?: NodeJS.ProcessEnv;
  spawnProcess?: SpawnSidecar;
  attachSockets?: (server: Server) => () => void;
}

export interface TailnetRemote {
  resume(): Promise<void>;
  status(): TailnetAccess;
  setEnabled(enabled: boolean): Promise<TailnetAccess>;
  stop(): Promise<void>;
}

export interface CreateTsnetRemoteInput extends Omit<StartTsnetRemoteInput, 'app'> {
  app: () => Hono;
  enabledAtBoot: boolean | null;
  recordPath: string;
}

const tsnetRecordSchema = z.object({ enabled: z.boolean() });
const RECORD_FILE_MODE = 0o600;

const OFF_STATUS: TailnetAccess = {
  enabled: false,
  state: 'off',
  dnsName: null,
  ips: [],
  authUrl: null,
  error: null,
};

function readEnabledRecord(recordPath: string): boolean | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(recordPath, 'utf8'));
  } catch {
    return null;
  }
  const record = tsnetRecordSchema.safeParse(parsed);
  return record.success ? record.data.enabled : null;
}

function writeEnabledRecord(recordPath: string, enabled: boolean): void {
  mkdirSync(dirname(recordPath), { recursive: true, mode: PRIVATE_DIR_MODE });
  const temp = `${recordPath}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ enabled })}\n`, { mode: RECORD_FILE_MODE });
  renameSync(temp, recordPath);
}

function setupErrorKind(lastError: string | null): TailnetErrorKind {
  const message = lastError ?? '';
  if (/sidecar binary|not executable/.test(message)) return 'missing-binary';
  if (/access token|CAIRN_AUTH/.test(message)) return 'auth-off';
  return 'unavailable';
}

export function createTsnetRemote(input: CreateTsnetRemoteInput): TailnetRemote {
  let enabled = input.enabledAtBoot ?? readEnabledRecord(input.recordPath) ?? false;
  let current: TsnetRemote | null = null;
  let setupError: TailnetErrorKind | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const status = (): TailnetAccess => {
    if (!enabled) return OFF_STATUS;
    const sidecar = current?.status();
    if (sidecar === undefined || sidecar.state === 'stopped') {
      return { ...OFF_STATUS, enabled: true, state: 'starting' };
    }
    return {
      enabled: true,
      state: sidecar.state,
      dnsName: sidecar.state === 'ready' ? sidecar.dnsName : null,
      ips: sidecar.state === 'ready' ? sidecar.ips : [],
      authUrl: sidecar.state === 'needs-login' ? sidecar.authUrl : null,
      error:
        sidecar.state === 'failed'
          ? (setupError ?? 'crashed')
          : sidecar.lastError !== null
            ? 'unavailable'
            : null,
    };
  };

  async function start(): Promise<void> {
    const previous = current;
    current = null;
    setupError = null;
    await previous?.stop();
    const started = await startTsnetRemote({
      ...input,
      app: input.app(),
      settings: { ...input.settings, enabled: true },
    });
    current = started;
    const now = started?.status();
    setupError = now?.state === 'failed' ? setupErrorKind(now.lastError) : null;
  }

  async function apply(next: boolean): Promise<TailnetAccess> {
    writeEnabledRecord(input.recordPath, next);
    enabled = next;
    if (!next) {
      const previous = current;
      current = null;
      setupError = null;
      await previous?.stop();
      return status();
    }
    const running = current?.status().state;
    if (running !== undefined && running !== 'failed' && running !== 'stopped') return status();
    await start();
    return status();
  }

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  return {
    resume: () =>
      enqueue(async () => {
        if (enabled) await start();
      }),
    status,
    setEnabled: (next: boolean) => enqueue(() => apply(next)),
    stop: () =>
      enqueue(async () => {
        await current?.stop();
        current = null;
      }),
  };
}

export function tsnetPathsOf(homeDir: string): TsnetPaths {
  const root = join(homeDir, TSNET_DIR_NAME);
  return { root, stateDir: join(root, 'state'), socketPath: join(root, SOCKET_FILE_NAME) };
}

function verifyBinary(binaryPath: string): void {
  try {
    if (!statSync(binaryPath).isFile()) throw new Error('not a file');
    accessSync(binaryPath, constants.X_OK);
  } catch {
    throw new Error(
      `sidecar binary ${binaryPath} is missing or not executable; build apps/tsnet-sidecar or set CAIRN_TSNET_BINARY`,
    );
  }
}

function verifySocketPathFits(socketPath: string): void {
  const bytes = Buffer.byteLength(socketPath);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    throw new Error(
      `unix socket path ${socketPath} is ${bytes} bytes, over the ${MAX_SOCKET_PATH_BYTES} byte limit; use a shorter CAIRN_HOME`,
    );
  }
}

function ensurePrivateDir(path: string, label: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  const info = lstatSync(path);
  if (!info.isDirectory()) {
    throw new Error(`${label} ${path} is not a real directory (symlinks are refused)`);
  }
  if (process.platform === 'win32') return;
  if (process.getuid !== undefined && info.uid !== process.getuid()) {
    throw new Error(`${label} ${path} is owned by another user`);
  }
  if ((info.mode & GROUP_AND_OTHER_BITS) === 0) return;
  chmodSync(path, PRIVATE_DIR_MODE);
  if ((lstatSync(path).mode & GROUP_AND_OTHER_BITS) !== 0) {
    throw new Error(`${label} ${path} is accessible to other users and could not be restricted`);
  }
}

function failedRemote(message: string): TsnetRemote {
  const status: SidecarStatus = {
    state: 'failed',
    authUrl: null,
    ips: [],
    dnsName: null,
    lastError: message,
    restarts: 0,
  };
  return { status: () => ({ ...status }), stop: () => Promise.resolve() };
}

export async function startTsnetRemote(input: StartTsnetRemoteInput): Promise<TsnetRemote | null> {
  const { settings, logger } = input;
  if (!settings.enabled) return null;
  const paths = tsnetPathsOf(input.homeDir);
  let listener: TailnetListener;
  let supervisor: SidecarSupervisor | null = null;
  try {
    if (input.authToken === null) {
      throw new Error(
        'tailnet access requires the access token, but token auth is disabled (CAIRN_AUTH=off); unset CAIRN_AUTH',
      );
    }
    verifyBinary(settings.binaryPath);
    verifySocketPathFits(paths.socketPath);
    ensurePrivateDir(paths.root, 'tsnet directory');
    ensurePrivateDir(paths.stateDir, 'tsnet state directory');
    listener = await listenOnTailnetSocket(
      input.app,
      paths.socketPath,
      () => supervisor?.status().dnsName ?? null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'tsnet remote access is enabled but could not start');
    return failedRemote(message);
  }
  const stopSockets = input.attachSockets?.(listener.server) ?? (() => {});
  if (settings.uploadLogs) {
    logger.warn({}, 'tsnet node log upload to Tailscale is enabled by CAIRN_TSNET_UPLOAD_LOGS');
  }
  logger.info(
    { socket: paths.socketPath, stateDir: paths.stateDir, hostname: settings.hostname },
    'tsnet remote access starting',
  );
  let running: SidecarSupervisor;
  try {
    running = superviseSidecar({
      launch: {
        binaryPath: settings.binaryPath,
        stateDir: paths.stateDir,
        socketPath: paths.socketPath,
        hostname: settings.hostname,
        controlUrl: settings.controlUrl,
        uploadLogs: settings.uploadLogs,
      },
      parentEnv: input.parentEnv ?? process.env,
      logger,
      ...(input.spawnProcess !== undefined ? { spawnProcess: input.spawnProcess } : {}),
      onStatus: (status) => {
        if (status.state === 'failed') {
          const closing = listener.close();
          stopSockets();
          void closing;
        }
      },
    });
  } catch (error) {
    const closing = listener.close();
    stopSockets();
    await closing;
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'tsnet remote access supervisor could not start');
    return failedRemote(message);
  }
  supervisor = running;
  return {
    status: running.status,
    stop: async () => {
      const closing = listener.close();
      stopSockets();
      await running.stop();
      await closing;
    },
  };
}
