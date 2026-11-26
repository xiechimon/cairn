import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  ENV_VARS,
  type MachineJson,
  machineEnrollResponseSchema,
  machineEnrollStartResponseSchema,
  machineJsonSchema,
  OWNER_CHANNEL_HEADER,
} from '@cairn/shared';
import { collectLegacyHostKeys, probeHostIdentity } from '@cairn/shared/host-identity';
import {
  applyShellEnvironment,
  SHELL_ENV_RESOLVED_VAR,
  type ShellEnvironmentPatch,
} from '@cairn/shared/shell-env';
import { withOtelFileEnv } from './otel-config.js';
import { createRestartBudget } from './restart-budget.js';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const STOP_TIMEOUT_MS = 10_000;
const RESTART_DELAY_MS = 5_000;
const MAX_RESTARTS = 5;
const STABLE_RUN_MS = 60_000;

export interface RunnerOptions {
  root: string;
  home: string;
  legacyHomes?: readonly string[];
  serverHome: string;
  deniedServerHomes?: readonly string[];
  origin: string;
  ownerToken: string;
  ownerChannelKey: string;
  authMode?: 'token' | 'session';
  fetchImpl?: typeof fetch;
  otelFile: string | null;
  agentDesktop: string | null;
  agentBrowser: string | null;
  shellEnv?: () => ShellEnvironmentPatch;
  isQuitting: () => boolean;
}

export class RunnerAuthPendingError extends Error {
  constructor(status: number) {
    super(`Remote runner enrollment waiting for sign-in (HTTP ${status})`);
    this.name = 'RunnerAuthPendingError';
  }
}

export interface LocalRunner {
  ensureRunning: () => void;
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
  });
  if (response.status === 401 || response.status === 403) {
    throw new RunnerAuthPendingError(response.status);
  }
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered HTTP ${response.status}`);
  return response.json();
}

async function verifyStoredMachine(
  origin: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`${origin}/api/machine/me`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function enrollLocalMachine(
  origin: string,
  ownerToken: string,
  ownerChannelKey: string,
  hostKey: string | undefined,
  legacyHostKeys: readonly string[],
  retireToken: string | undefined,
  authMode: 'token' | 'session',
  fetchImpl: typeof fetch,
): Promise<MachineJson> {
  const started = machineEnrollStartResponseSchema.parse(
    await postJson(
      `${origin}/api/machine/enroll/start`,
      {
        name: hostname(),
        ...(hostKey !== undefined ? { hostKey } : {}),
        ...(legacyHostKeys.length > 0 ? { legacyHostKeys } : {}),
      },
      {},
      fetchImpl,
    ),
  );
  const confirmHeaders: Record<string, string> =
    authMode === 'session'
      ? { Origin: origin, 'Sec-Fetch-Site': 'same-origin' }
      : {
          Authorization: `Bearer ${ownerToken}`,
          [OWNER_CHANNEL_HEADER]: ownerChannelKey,
        };
  for (let attempt = 0; ; attempt++) {
    try {
      const confirmed = (await postJson(
        `${origin}/api/machine/enroll/confirm`,
        {
          enrollId: started.enrollId,
          ...(retireToken !== undefined ? { retireToken } : {}),
        },
        confirmHeaders,
        fetchImpl,
      )) as { machine?: unknown };
      return machineEnrollResponseSchema.parse(confirmed.machine);
    } catch (error) {
      const pending =
        error instanceof Error && error.message.endsWith('answered HTTP 503') && attempt < 9;
      if (!pending) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

export function readRunnerRegistration(home: string): MachineJson | undefined {
  return readStoredMachine(home);
}

const MAX_MACHINE_JSON_BYTES = 16_384;

function readStoredMachine(home: string, rejectSymlinkDir = false): MachineJson | undefined {
  let fd: number | undefined;
  try {
    if (rejectSymlinkDir && lstatSync(home).isSymbolicLink()) return undefined;
    const path = join(home, 'machine.json');
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_MACHINE_JSON_BYTES) return undefined;
    const parsed = machineJsonSchema.safeParse(JSON.parse(readFileSync(fd, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch (error) {
        console.debug('cairn: recoverable operation failed', error);
      }
    }
  }
}

function writeMachineJson(home: string, machine: MachineJson): void {
  mkdirSync(home, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(home, PRIVATE_DIR_MODE);
  const path = join(home, 'machine.json');
  writeFileSync(path, `${JSON.stringify(machine, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
  chmodSync(path, PRIVATE_FILE_MODE);
}

function runnerEnv(options: RunnerOptions): NodeJS.ProcessEnv {
  const env = withOtelFileEnv(
    {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      [ENV_VARS.home]: options.home,
      [ENV_VARS.parentPid]: String(process.pid),
      [ENV_VARS.confineDeniedRoots]: [
        ...new Set([
          options.serverHome,
          ...(options.deniedServerHomes ?? []),
          ...(options.legacyHomes ?? []),
        ]),
      ].join(delimiter),
      [ENV_VARS.server]: options.origin,
      [ENV_VARS.skillsDir]: join(options.home, 'skills'),
      [ENV_VARS.mcpConfig]: join(options.home, 'mcp.json'),
      ...(options.agentDesktop === null
        ? {}
        : { CAIRN_AGENT_DESKTOP: options.agentDesktop, CAIRN_OWN_COMPUTER: '1' }),
      ...(options.agentBrowser === null ? {} : { CAIRN_AGENT_BROWSER: options.agentBrowser }),
    },
    options.otelFile,
  );
  const discovered = options.shellEnv?.();
  if (discovered !== undefined) applyShellEnvironment(env, discovered, process.platform);
  env[SHELL_ENV_RESOLVED_VAR] = '1';
  delete env[ENV_VARS.token];
  delete env[ENV_VARS.auth];
  delete env[ENV_VARS.apiKey];
  return env;
}

export async function startLocalRunner(options: RunnerOptions): Promise<LocalRunner> {
  const authMode = options.authMode ?? 'token';
  const fetchImpl = options.fetchImpl ?? fetch;
  const previous = readStoredMachine(options.home);
  const previousForOrigin =
    previous !== undefined && previous.serverUrl === options.origin ? previous : undefined;
  const legacyHomes = options.legacyHomes ?? [];
  const siblingStored = legacyHomes
    .map((dir) => readStoredMachine(dir, true))
    .filter(
      (entry): entry is MachineJson => entry !== undefined && entry.serverUrl === options.origin,
    );
  const probed = probeHostIdentity(options.home, undefined, legacyHomes);
  const hostKey = probed?.hostKey ?? previousForOrigin?.hostKey ?? undefined;
  const legacyHostKeys = collectLegacyHostKeys(hostKey, [
    ...(probed?.legacyHostKeys ?? []),
    previousForOrigin?.hostKey,
    ...siblingStored.map((entry) => entry.hostKey),
  ]);
  const reuseExisting =
    authMode === 'session' &&
    previousForOrigin !== undefined &&
    (await verifyStoredMachine(options.origin, previousForOrigin.token, fetchImpl));
  if (!reuseExisting) {
    const retireToken = previousForOrigin?.token ?? siblingStored[0]?.token;
    writeMachineJson(options.home, {
      ...(await enrollLocalMachine(
        options.origin,
        options.ownerToken,
        options.ownerChannelKey,
        hostKey,
        legacyHostKeys,
        retireToken,
        authMode,
        fetchImpl,
      )),
      ...(hostKey !== undefined ? { hostKey } : {}),
    });
  }
  let child: ChildProcess | null = null;
  let unit: string | null = null;
  let pending: NodeJS.Timeout | null = null;
  let halted = false;
  const budget = createRestartBudget(MAX_RESTARTS, STABLE_RUN_MS);
  const launch = (): void => {
    pending = null;
    budget.started();
    const env = runnerEnv(options);
    const command = [
      process.execPath,
      join(options.root, 'dist', 'cli.mjs'),
      'start',
      '--foreground',
      '--server',
      options.origin,
    ];
    unit = process.platform === 'linux' ? `cairn-desktop-runner-${randomUUID()}.service` : null;
    const args =
      unit === null
        ? command.slice(1)
        : [
            '--user',
            '--pipe',
            '--wait',
            '--collect',
            '--quiet',
            '--same-dir',
            '--service-type=exec',
            '--expand-environment=no',
            `--unit=${unit}`,
            '--property=KillMode=control-group',
            '--property=TimeoutStopSec=5s',
            ...Object.keys(env)
              .filter((name) => {
                const value = env[name];
                return (
                  typeof value === 'string' &&
                  !/[\r\n\0]/.test(value) &&
                  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
                  !/^(INVOCATION_ID|JOURNAL_STREAM|SYSTEMD_EXEC_PID|MANAGERPID|NOTIFY_SOCKET|LISTEN_PID|LISTEN_FDS|LISTEN_FDNAMES|WATCHDOG_PID|WATCHDOG_USEC)$/.test(
                    name,
                  )
                );
              })
              .map((name) => `--setenv=${name}`),
            '--',
            ...command,
          ];
    const started = spawn(unit === null ? process.execPath : 'systemd-run', args, {
      cwd: options.home,
      env,
      stdio: 'inherit',
    });
    child = started;
    started.once('error', (error) => console.error('Cairn Runner could not launch:', error));
    started.once('close', (code, signal) => {
      child = null;
      unit = null;
      if (options.isQuitting() || halted) return;
      if (!budget.exited()) {
        console.error(`Cairn Runner exited (code ${code}, signal ${signal}); not restarting`);
        return;
      }
      console.error(`Cairn Runner exited (code ${code}, signal ${signal}); restarting`);
      pending = setTimeout(launch, RESTART_DELAY_MS);
    });
  };
  if (!options.isQuitting()) launch();
  return {
    ensureRunning: () => {
      halted = false;
      if (child !== null || options.isQuitting()) return;
      if (pending !== null) clearTimeout(pending);
      budget.reset();
      if (!options.isQuitting()) launch();
    },
    isRunning: () => child !== null || pending !== null,
    stop: () => {
      halted = true;
      if (pending !== null) clearTimeout(pending);
      pending = null;
      const running = child;
      if (running === null) return Promise.resolve();
      return new Promise((done) => {
        const timer = setTimeout(() => {
          running.kill('SIGKILL');
          done();
        }, STOP_TIMEOUT_MS);
        running.once('close', () => {
          clearTimeout(timer);
          done();
        });
        if (unit === null) running.kill('SIGTERM');
        else
          execFile('systemctl', ['--user', 'stop', unit], { timeout: STOP_TIMEOUT_MS }, (error) => {
            if (error !== null)
              console.error('Cairn Runner service could not stop:', error.message);
          });
      });
    },
  };
}
