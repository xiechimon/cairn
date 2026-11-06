import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';

const MAX_LINE_CHARS = 64 * 1024;
const MAX_LOGGED_CHARS = 2_000;
const SHUTDOWN_COMMAND = `${JSON.stringify({ cmd: 'shutdown' })}\n`;

const INHERITED_ENV_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'SYSTEMROOT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
]);
const INHERITED_ENV_PREFIXES = ['TS_', 'TSNET_'];
const NO_LOGS_ENV = 'TS_NO_LOGS_NO_SUPPORT';

export interface Backoff {
  initialMs: number;
  maxMs: number;
  stableMs: number;
}

const DEFAULT_BACKOFF: Backoff = { initialMs: 1_000, maxMs: 60_000, stableMs: 30_000 };
const DEFAULT_STOP_GRACE_MS = 5_000;
const DEFAULT_KILL_GRACE_MS = 2_000;

export interface SidecarLaunch {
  binaryPath: string;
  stateDir: string;
  socketPath: string;
  hostname: string;
  controlUrl: string | null;
  uploadLogs: boolean;
}

export type SidecarState =
  | 'starting'
  | 'needs-login'
  | 'ready'
  | 'restarting'
  | 'failed'
  | 'stopped';

export interface SidecarStatus {
  state: SidecarState;
  authUrl: string | null;
  ips: string[];
  dnsName: string | null;
  lastError: string | null;
  restarts: number;
}

export interface SidecarProcess extends EventEmitter {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly stdin: Writable;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnSidecar = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => SidecarProcess;

export interface SidecarLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
  error(fields: object, message: string): void;
  debug(fields: object, message: string): void;
}

export interface SidecarSupervisor {
  status(): SidecarStatus;
  stop(): Promise<void>;
}

export interface SuperviseInput {
  launch: SidecarLaunch;
  parentEnv: NodeJS.ProcessEnv;
  logger: SidecarLogger;
  onStatus?: (status: SidecarStatus) => void;
  spawnProcess?: SpawnSidecar;
  backoff?: Partial<Backoff>;
  stopGraceMs?: number;
  killGraceMs?: number;
}

const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = URL.parse(value)?.protocol;
    return protocol === 'https:' || protocol === 'http:';
  });

const sidecarEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authUrl'), url: httpUrl }),
  z.object({
    type: z.literal('ready'),
    ips: z.array(z.string()).default([]),
    dnsName: z.string().min(1),
  }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('funnel') }).passthrough(),
  z.object({ type: z.literal('stopped') }),
]);

export function sidecarArgs(launch: SidecarLaunch): string[] {
  return [
    '--state-dir',
    launch.stateDir,
    '--tailnet-upstream',
    `unix:${launch.socketPath}`,
    '--hostname',
    launch.hostname,
    ...(launch.controlUrl === null ? [] : ['--control-url', launch.controlUrl]),
    ...(launch.uploadLogs ? ['--upload-logs'] : []),
  ];
}

export function sidecarEnv(parent: NodeJS.ProcessEnv, uploadLogs: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (
      INHERITED_ENV_NAMES.has(name) ||
      INHERITED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      env[name] = value;
    }
  }
  if (!uploadLogs) env[NO_LOGS_ENV] = 'true';
  return env;
}

export function restartDelayMs(consecutiveFailures: number, backoff: Backoff): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  return Math.min(backoff.maxMs, backoff.initialMs * 2 ** exponent);
}

const spawnChild: SpawnSidecar = (command, args, env) =>
  spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal === null ? `sidecar exited with code ${code}` : `sidecar killed by ${signal}`;
}

export function superviseSidecar(input: SuperviseInput): SidecarSupervisor {
  const { launch, logger } = input;
  const backoff: Backoff = { ...DEFAULT_BACKOFF, ...input.backoff };
  const stopGraceMs = input.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
  const killGraceMs = input.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const spawnProcess = input.spawnProcess ?? spawnChild;
  const args = sidecarArgs(launch);
  const env = sidecarEnv(input.parentEnv, launch.uploadLogs);

  let status: SidecarStatus = {
    state: 'starting',
    authUrl: null,
    ips: [],
    dnsName: null,
    lastError: null,
    restarts: 0,
  };
  let child: SidecarProcess | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let stopTimers: NodeJS.Timeout[] = [];
  let consecutiveFailures = 0;
  let startedAt = 0;
  let reachedReady = false;
  let runError: string | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopped: (() => void) | null = null;

  function update(patch: Partial<SidecarStatus>): void {
    status = { ...status, ...patch };
    input.onStatus?.(snapshot());
  }

  function snapshot(): SidecarStatus {
    return { ...status, ips: [...status.ips] };
  }

  function fail(message: string): void {
    child = null;
    logger.error({ error: message, binary: launch.binaryPath }, 'tsnet sidecar failed permanently');
    update({ state: 'failed', authUrl: null, ips: [], dnsName: null, lastError: message });
  }

  function handleEvent(event: z.infer<typeof sidecarEventSchema>): void {
    switch (event.type) {
      case 'authUrl':
        logger.info({ authUrl: event.url }, 'tsnet sidecar needs a Tailscale login');
        update({ state: 'needs-login', authUrl: event.url });
        return;
      case 'ready':
        reachedReady = true;
        runError = null;
        update({
          state: 'ready',
          authUrl: null,
          ips: event.ips,
          dnsName: event.dnsName,
          lastError: null,
        });
        return;
      case 'error':
        runError = event.error;
        logger.warn({ error: event.error }, 'tsnet sidecar reported an error');
        update({ lastError: event.error });
        return;
      case 'funnel':
      case 'stopped':
        return;
    }
  }

  function handleLine(line: string): void {
    if (line.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.warn({ line: line.slice(0, MAX_LOGGED_CHARS) }, 'tsnet sidecar wrote a non-JSON line');
      return;
    }
    const event = sidecarEventSchema.safeParse(parsed);
    if (!event.success) {
      logger.warn(
        { line: line.slice(0, MAX_LOGGED_CHARS) },
        'tsnet sidecar wrote an unknown event',
      );
      return;
    }
    handleEvent(event.data);
  }

  function readLines(proc: SidecarProcess): void {
    let buffered = '';
    let skippingOverlongLine = false;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      for (let newline = buffered.indexOf('\n'); newline !== -1; newline = buffered.indexOf('\n')) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (skippingOverlongLine) skippingOverlongLine = false;
        else if (line.length > MAX_LINE_CHARS)
          logger.warn({}, 'tsnet sidecar wrote an overlong line');
        else handleLine(line);
      }
      if (buffered.length > MAX_LINE_CHARS) {
        buffered = '';
        skippingOverlongLine = true;
        logger.warn({}, 'tsnet sidecar wrote an overlong line');
      }
    });
  }

  function clearStopTimers(): void {
    for (const timer of stopTimers) clearTimeout(timer);
    stopTimers = [];
  }

  function finishStop(): void {
    clearStopTimers();
    child = null;
    update({ state: 'stopped', authUrl: null, ips: [], dnsName: null });
    stopped?.();
  }

  function onExit(proc: SidecarProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (proc !== child) return;
    child = null;
    if (stopPromise !== null) {
      finishStop();
      return;
    }
    const stable = reachedReady || Date.now() - startedAt >= backoff.stableMs;
    consecutiveFailures = stable ? 1 : consecutiveFailures + 1;
    const delayMs = restartDelayMs(consecutiveFailures, backoff);
    const reason = runError ?? describeExit(code, signal);
    logger.warn({ code, signal, delayMs, reason }, 'tsnet sidecar exited; restarting');
    update({ state: 'restarting', authUrl: null, ips: [], dnsName: null, lastError: reason });
    restartTimer = setTimeout(() => {
      restartTimer = null;
      launchProcess(status.restarts + 1);
    }, delayMs);
  }

  function onSpawnError(proc: SidecarProcess, error: Error): void {
    if (proc !== child) return;
    try {
      proc.kill('SIGKILL');
    } catch {
      void 0;
    }
    if (stopPromise !== null) {
      finishStop();
      return;
    }
    fail(error.message);
  }

  function launchProcess(restarts: number): void {
    startedAt = Date.now();
    reachedReady = false;
    runError = null;
    let proc: SidecarProcess;
    try {
      proc = spawnProcess(launch.binaryPath, args, env);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    }
    child = proc;
    update({ state: 'starting', authUrl: null, ips: [], dnsName: null, restarts });
    readLines(proc);
    proc.stderr.on('data', (chunk: Buffer | string) => {
      logger.debug({ stderr: chunk.toString().slice(0, MAX_LOGGED_CHARS) }, 'tsnet sidecar stderr');
    });
    proc.stdin.on('error', () => void 0);
    proc.on('error', (error: Error) => onSpawnError(proc, error));
    proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) =>
      onExit(proc, code, signal),
    );
  }

  function requestShutdown(proc: SidecarProcess): void {
    try {
      proc.stdin.write(SHUTDOWN_COMMAND);
      proc.stdin.end();
    } catch {
      void 0;
    }
    stopTimers.push(
      setTimeout(() => {
        proc.kill('SIGTERM');
        stopTimers.push(
          setTimeout(() => {
            proc.kill('SIGKILL');
            stopTimers.push(setTimeout(finishStop, killGraceMs));
          }, killGraceMs),
        );
      }, stopGraceMs),
    );
  }

  function stop(): Promise<void> {
    if (stopPromise !== null) return stopPromise;
    stopPromise = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (child === null) finishStop();
    else requestShutdown(child);
    return stopPromise;
  }

  launchProcess(0);
  return { status: snapshot, stop };
}
