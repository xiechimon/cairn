import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import {
  ENV_VARS,
  type MachineJson,
  machineEnrollResponseSchema,
  machineEnrollStartResponseSchema,
} from '@cairn/shared';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const STOP_TIMEOUT_MS = 10_000;
const RESTART_DELAY_MS = 5_000;
const MAX_RESTARTS = 5;

export interface RunnerOptions {
  root: string;
  home: string;
  origin: string;
  ownerToken: string;
  isQuitting: () => boolean;
}

export interface LocalRunner {
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    [ENV_VARS.home]: options.home,
    [ENV_VARS.server]: options.origin,
    [ENV_VARS.skillsDir]: join(options.home, 'skills'),
    [ENV_VARS.mcpConfig]: join(options.home, 'mcp.json'),
    CLAUDE_CONFIG_DIR: join(options.home, 'claude'),
  };
  delete env[ENV_VARS.token];
  delete env[ENV_VARS.auth];
  return env;
}

export async function startLocalRunner(options: RunnerOptions): Promise<LocalRunner> {
  writeMachineJson(options.home, await enrollLocalMachine(options.origin, options.ownerToken));
  let child: ChildProcess | null = null;
  let restarts = 0;
  const launch = (): void => {
    const started = spawn(
      process.execPath,
      [join(options.root, 'dist', 'cli.mjs'), 'start', '--foreground', '--server', options.origin],
      { cwd: options.home, env: runnerEnv(options), stdio: 'inherit' },
    );
    child = started;
    started.once('exit', (code, signal) => {
      child = null;
      if (options.isQuitting() || restarts >= MAX_RESTARTS) return;
      restarts += 1;
      console.error(
        `Cairn Runner exited (code ${code}, signal ${signal}); restart ${restarts} of ${MAX_RESTARTS}`,
      );
      setTimeout(launch, RESTART_DELAY_MS);
    });
  };
  launch();
  return {
    stop: () => {
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
