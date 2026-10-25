import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { createDaemonLogger } from './log.js';
import { nextBackoffMs } from './machine-loop.js';
import { clearDaemonJson, loadDaemonJson, statePaths, writeDaemonJson } from './state.js';

function nodeCliArgv(cliPath: string, rest: string[]): string[] {
  return cliPath.endsWith('.ts') ? ['--import', 'tsx', cliPath, ...rest] : [cliPath, ...rest];
}

export interface SupervisorOpts {
  home: string;
  runnerArgv: string[];
  cliPath?: string;
}

export function spawnSupervisor(opts: SupervisorOpts): { pid: number } {
  const paths = statePaths(opts.home);
  const existing = loadDaemonJson(paths);
  if (existing && isAlive(existing.pid)) {
    throw new Error(`daemon already running (pid ${existing.pid})`);
  }
  const logFd = openSync(paths.daemonLog, 'a');
  const cliPath = opts.cliPath ?? process.argv[1] ?? '';
  const child = spawn(process.execPath, nodeCliArgv(cliPath, ['supervise', ...opts.runnerArgv]), {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) throw new Error('failed to spawn supervisor');
  return { pid: child.pid };
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
    await new Promise((r) => setTimeout(r, backoff));
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
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isAlive(daemon.pid);
}
