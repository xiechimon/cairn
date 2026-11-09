import { accessSync, chmodSync, constants, lstatSync, mkdirSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
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
  readLocalStatus?: () => Promise<unknown>;
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

const localStatusSchema = z.object({
  BackendState: z.string(),
  Self: z
    .object({
      DNSName: z.string().optional(),
      UserID: z.number().int().or(z.string()).optional(),
      Tags: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
  User: z.record(z.string(), z.object({ LoginName: z.string() })).optional(),
  TailscaleIPs: z.array(z.string()).optional(),
});

export function parseLocalStatus(body: string): unknown {
  return JSON.parse(body, (key: string, value: unknown, context?: { source?: string }): unknown =>
    key === 'UserID' && typeof value === 'number' ? context?.source : value,
  );
}

function readSystemStatus(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socketPath =
      process.platform === 'darwin'
        ? '/var/run/tailscaled.socket'
        : '/var/run/tailscale/tailscaled.sock';
    const req = request(
      {
        socketPath,
        path: '/localapi/v0/status?peers=false',
        headers: { host: 'local-tailscaled.sock' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 4 * 1024 * 1024)
            req.destroy(new Error('LocalAPI status exceeds limit'));
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error('LocalAPI status unavailable');
            resolve(parseLocalStatus(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.setTimeout(2_000, () => req.destroy(new Error('LocalAPI status timed out')));
    req.on('error', reject);
    req.end();
  });
}

export async function startTsnetRemote(input: StartTsnetRemoteInput): Promise<TsnetRemote | null> {
  const { settings, logger } = input;
  if (!settings.enabled) return null;
  const paths = tsnetPathsOf(input.homeDir);
  let listener: TailnetListener;
  let supervisor: SidecarSupervisor | null = null;
  let socketStatus: SidecarStatus = {
    state: 'ready',
    authUrl: null,
    ips: [],
    dnsName: null,
    ownerLogin: null,
    selfTagged: false,
    lastError: null,
    restarts: 0,
  };
  let stopped = false;
  let knownSelfAddresses: string[] | null = null;
  const refreshSystemStatus = async () => {
    try {
      const status = localStatusSchema.parse(await (input.readLocalStatus ?? readSystemStatus)());
      if (stopped) return;
      const running = status.BackendState === 'Running';
      const selfTagged = (status.Self?.Tags?.length ?? 0) > 0;
      const userId = status.Self?.UserID;
      if (running && (status.TailscaleIPs?.length ?? 0) > 0)
        knownSelfAddresses = status.TailscaleIPs ?? null;
      socketStatus = {
        ...socketStatus,
        dnsName: running ? (status.Self?.DNSName?.replace(/\.$/, '') ?? null) : null,
        ips: running ? (status.TailscaleIPs ?? []) : [],
        selfTagged,
        ownerLogin:
          running && !selfTagged && userId !== undefined
            ? (status.User?.[String(userId)]?.LoginName ?? null)
            : null,
        lastError: null,
      };
    } catch {
      if (!stopped)
        socketStatus = {
          ...socketStatus,
          ownerLogin: null,
          selfTagged: false,
          dnsName: null,
          ips: [],
          lastError:
            'LocalAPI status unavailable; only the explicit socket allowlist can grant identity access',
        };
    }
  };
  try {
    if (input.authToken === null) {
      throw new Error(
        'tailnet access requires the access token, but token auth is disabled (CAIRN_AUTH=off); unset CAIRN_AUTH',
      );
    }
    if (settings.mode !== 'socket') verifyBinary(settings.binaryPath);
    verifySocketPathFits(paths.socketPath);
    ensurePrivateDir(paths.root, 'tsnet directory');
    ensurePrivateDir(paths.stateDir, 'tsnet state directory');
    if (settings.mode === 'socket') await refreshSystemStatus();
    listener = await listenOnTailnetSocket(
      input.app,
      paths.socketPath,
      () =>
        settings.mode === 'socket' ? socketStatus.dnsName : (supervisor?.status().dnsName ?? null),
      () => {
        const status = settings.mode === 'socket' ? socketStatus : supervisor?.status();
        return {
          ownerLogin: status?.state === 'ready' ? (status.ownerLogin ?? null) : null,
          selfTagged: status?.selfTagged ?? false,
          allowedLogins: settings.allowedLogins ?? [],
          selfAddresses: settings.mode === 'socket' ? knownSelfAddresses : (status?.ips ?? []),
        };
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'tsnet remote access is enabled but could not start');
    return failedRemote(message);
  }
  if (settings.mode === 'socket') {
    const timer = setInterval(() => {
      void refreshSystemStatus();
    }, 30_000);
    timer.unref();
    logger.info({ socket: paths.socketPath }, 'private tailnet socket ready for system tailscaled');
    return {
      status: () => ({ ...socketStatus, ips: [...socketStatus.ips] }),
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        socketStatus = { ...socketStatus, state: 'stopped', ownerLogin: null };
        await listener.close();
      },
    };
  }
  if (settings.uploadLogs) {
    logger.warn({}, 'tsnet node log upload to Tailscale is enabled by CAIRN_TSNET_UPLOAD_LOGS');
  }
  logger.info(
    { socket: paths.socketPath, stateDir: paths.stateDir, hostname: settings.hostname },
    'tsnet remote access starting',
  );
  const running = superviseSidecar({
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
  supervisor = running;
  return {
    status: running.status,
    stop: async () => {
      await running.stop();
      await listener.close();
    },
  };
}
