import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_DESKTOP_VERSION,
  ENV_VARS,
  type MachineJson,
  machineEnrollResponseSchema,
  machineEnrollStartResponseSchema,
} from '@cairn/shared';
import { type OtelEnv, withOtelEnv } from './otel-config.js';
import { ownComputerRunnerEnv } from './own-computer.js';
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
  serverHome: string;
  origin: string;
  ownerToken: string;
  otelEnv: OtelEnv;
  isQuitting: () => boolean;
}

export interface LocalRunner {
  ensureRunning: () => void;
  stop: () => Promise<void>;
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered HTTP ${response.status}`);
  return response.json();
}

async function enrollLocalMachine(origin: string, ownerToken: string): Promise<MachineJson> {
  const started = machineEnrollStartResponseSchema.parse(
    await postJson(`${origin}/api/machine/enroll/start`, { name: hostname() }),
  );
  const confirmed = (await postJson(
    `${origin}/api/machine/enroll/confirm`,
    { enrollId: started.enrollId },
    { Authorization: `Bearer ${ownerToken}` },
  )) as { machine?: unknown };
  return machineEnrollResponseSchema.parse(confirmed.machine);
}

function writeMachineJson(home: string, machine: MachineJson): void {
  mkdirSync(home, { recursive: true, mode: PRIVATE_DIR_MODE });
  chmodSync(home, PRIVATE_DIR_MODE);
  const path = join(home, 'machine.json');
  writeFileSync(path, `${JSON.stringify(machine, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
  chmodSync(path, PRIVATE_FILE_MODE);
}

function runnerEnv(options: RunnerOptions): NodeJS.ProcessEnv {
  const env = withOtelEnv(
    {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      [ENV_VARS.home]: options.home,
      [ENV_VARS.confineDeniedRoots]: options.serverHome,
      [ENV_VARS.server]: options.origin,
      [ENV_VARS.skillsDir]: join(options.home, 'skills'),
      [ENV_VARS.mcpConfig]: join(options.home, 'mcp.json'),
      CLAUDE_CONFIG_DIR: join(options.home, 'claude'),
      ...ownComputerRunnerEnv(options.home, process.platform, AGENT_DESKTOP_VERSION),
    },
    options.otelEnv,
  );
  delete env[ENV_VARS.token];
  delete env[ENV_VARS.auth];
  return env;
}

export async function startLocalRunner(options: RunnerOptions): Promise<LocalRunner> {
  writeMachineJson(options.home, await enrollLocalMachine(options.origin, options.ownerToken));
  let child: ChildProcess | null = null;
  let pending: NodeJS.Timeout | null = null;
  const budget = createRestartBudget(MAX_RESTARTS, STABLE_RUN_MS);
  const launch = (): void => {
    pending = null;
    budget.started();
    const started = spawn(
      process.execPath,
      [join(options.root, 'dist', 'cli.mjs'), 'start', '--foreground', '--server', options.origin],
      { cwd: options.home, env: runnerEnv(options), stdio: 'inherit' },
    );
    child = started;
    started.once('exit', (code, signal) => {
      child = null;
      if (options.isQuitting()) return;
      if (!budget.exited()) {
        console.error(`Cairn Runner exited (code ${code}, signal ${signal}); not restarting`);
        return;
      }
      console.error(`Cairn Runner exited (code ${code}, signal ${signal}); restarting`);
      pending = setTimeout(launch, RESTART_DELAY_MS);
    });
  };
  launch();
  return {
    ensureRunning: () => {
      if (child !== null || options.isQuitting()) return;
      if (pending !== null) clearTimeout(pending);
      budget.reset();
      launch();
    },
    stop: () => {
      if (pending !== null) clearTimeout(pending);
      pending = null;
      const running = child;
      if (running === null) return Promise.resolve();
      return new Promise((done) => {
        const timer = setTimeout(() => {
          running.kill('SIGKILL');
          done();
        }, STOP_TIMEOUT_MS);
        running.once('exit', () => {
          clearTimeout(timer);
          done();
        });
        running.kill('SIGTERM');
      });
    },
  };
}
