import { accessSync, chmodSync, constants, lstatSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { TsnetSettings } from '../config.js';
import { listenOnTailnetSocket, type TailnetListener } from '../lib/tailnet-listener.js';
import {
  type SidecarLogger,
  type SidecarStatus,
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
  logger: SidecarLogger;
  parentEnv?: NodeJS.ProcessEnv;
  spawnProcess?: SpawnSidecar;
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
  try {
    verifyBinary(settings.binaryPath);
    verifySocketPathFits(paths.socketPath);
    ensurePrivateDir(paths.root, 'tsnet directory');
    ensurePrivateDir(paths.stateDir, 'tsnet state directory');
    listener = await listenOnTailnetSocket(input.app, paths.socketPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'tsnet remote access is enabled but could not start');
    return failedRemote(message);
  }
  if (settings.uploadLogs) {
    logger.warn({}, 'tsnet node log upload to Tailscale is enabled by CAIRN_TSNET_UPLOAD_LOGS');
  }
  logger.info(
    { socket: paths.socketPath, stateDir: paths.stateDir, hostname: settings.hostname },
    'tsnet remote access starting',
  );
  const supervisor = superviseSidecar({
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
      if (status.state === 'failed') void listener.close();
    },
  });
  return {
    status: supervisor.status,
    stop: async () => {
      await supervisor.stop();
      await listener.close();
    },
  };
}
