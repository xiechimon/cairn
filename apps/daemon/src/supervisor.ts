import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openSync } from 'node:fs';
import { sleep } from '@cairn/shared';
import { createDaemonLogger } from './log.js';
import { nextBackoffMs } from './machine-loop.js';
import { ensurePrivateDir } from './private-fs.js';
import { clearDaemonJson, loadDaemonJson, statePaths, writeDaemonJson } from './state.js';

function nodeCliArgv(cliPath: string, rest: string[]): string[] {
  return cliPath.endsWith('.ts') ? ['--import', 'tsx', cliPath, ...rest] : [cliPath, ...rest];
}

export interface SupervisorOpts {
  home: string;
  runnerArgv: string[];
  cliPath?: string;
}

export type SupervisorStart =
  | { pid: number; unit: string }
  | { pid: number; unit: null; unitFailure: string | null };

const SYSTEMD_OWNED_ENV = new Set([
  'INVOCATION_ID',
  'JOURNAL_STREAM',
  'SYSTEMD_EXEC_PID',
  'MANAGERPID',
  'NOTIFY_SOCKET',
  'LISTEN_PID',
  'LISTEN_FDS',
  'LISTEN_FDNAMES',
  'WATCHDOG_PID',
  'WATCHDOG_USEC',
]);

function userUnitArgv(unit: string, daemonLog: string, command: string[]): string[] {
  const inherited = Object.keys(process.env).filter((name) => {
    const value = process.env[name];
    return (
      typeof value === 'string' &&
      !/[\r\n\0]/.test(value) &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
      !SYSTEMD_OWNED_ENV.has(name)
    );
  });
  return [
    '--user',
    `--unit=${unit}`,
    '--description=Cairn daemon',
    '--collect',
    '--quiet',
    '--same-dir',
    `--property=StandardOutput=append:${daemonLog}`,
    `--property=StandardError=append:${daemonLog}`,
    ...inherited.map((name) => `--setenv=${name}`),
    '--',
    ...command,
  ];
}

function startUserUnit(
  daemonLog: string,
  command: string[],
): { pid: number; unit: string } | { failure: string } {
  const unit = `cairn-daemon-${randomUUID().slice(0, 8)}.service`;
  const started = spawnSync('systemd-run', userUnitArgv(unit, daemonLog, command), {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (started.error !== undefined || started.status !== 0) {
    const stderr = typeof started.stderr === 'string' ? started.stderr.trim() : '';
    return { failure: started.error?.message ?? (stderr || `exit ${started.status}`) };
  }
  const shown = spawnSync('systemctl', ['--user', 'show', '--property=MainPID', '--value', unit], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  const pid = Number.parseInt(typeof shown.stdout === 'string' ? shown.stdout : '', 10);
  return { pid: Number.isInteger(pid) ? pid : 0, unit };
}

export function spawnSupervisor(opts: SupervisorOpts): SupervisorStart {
  const paths = statePaths(opts.home);
  const existing = loadDaemonJson(paths);
  if (existing && isAlive(existing.pid)) {
    throw new Error(`daemon already running (pid ${existing.pid})`);
  }
  ensurePrivateDir(paths.home);
  const cliPath = opts.cliPath ?? process.argv[1] ?? '';
  const argv = nodeCliArgv(cliPath, ['supervise', ...opts.runnerArgv]);
  let unitFailure: string | null = null;
  if (process.platform === 'linux') {
    const started = startUserUnit(paths.daemonLog, [process.execPath, ...argv]);
    if ('unit' in started) return started;
    unitFailure = started.failure;
  }
  const logFd = openSync(paths.daemonLog, 'a');
  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) throw new Error('failed to spawn supervisor');
  return { pid: child.pid, unit: null, unitFailure };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runSupervisor(opts: SupervisorOpts): Promise<void> {
  const paths = statePaths(opts.home);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  const cliPath = opts.cliPath ?? process.argv[1] ?? '';
  let stopping = false;
  let runner: ReturnType<typeof spawn> | null = null;

  writeDaemonJson(paths, { pid: process.pid, startedAt: Date.now(), runner: 'cli' });

  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    runner?.kill('SIGTERM');
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  let backoff = 1_000;
  while (!stopping) {
    const exitCode = await new Promise<number | null>((resolve) => {
      runner = spawn(process.execPath, nodeCliArgv(cliPath, opts.runnerArgv), {
        stdio: 'inherit',
        env: process.env,
      });
      runner.on('exit', (code) => resolve(code));
      runner.on('error', () => resolve(null));
    });
    if (stopping) break;
    logger.supervisor(`runner exited (code ${exitCode ?? 'signal'}) — restarting in ${backoff}ms`);
    await sleep(backoff);
    backoff = nextBackoffMs(backoff);
  }
  clearDaemonJson(paths);
  logger.supervisor('stopped');
}

export async function stopSupervisor(home: string, timeoutMs = 8_000): Promise<boolean> {
  const paths = statePaths(home);
  const daemon = loadDaemonJson(paths);
  if (!daemon || !isAlive(daemon.pid)) {
    clearDaemonJson(paths);
    return false;
  }
  process.kill(daemon.pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(daemon.pid)) return true;
    await sleep(100);
  }
  return !isAlive(daemon.pid);
}
