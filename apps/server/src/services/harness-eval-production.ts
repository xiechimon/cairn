import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HarnessEvalDispatchPort,
  HarnessEvalDispatchRequest,
} from './harness-eval-coordinator.js';

export const DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS = 60 * 60 * 1000;

export function resolveHarnessEvalWorkerScriptFrom(here: string): string {
  const srcForm = resolve(here, '../../../../scripts/harness-eval-worker.mjs');
  const packagedForm = resolve(here, 'harness-eval-worker.mjs');
  const repoForm = resolve(here, '../../../scripts/harness-eval-worker.mjs');
  if (existsSync(srcForm)) return srcForm;
  if (existsSync(packagedForm)) return packagedForm;
  return repoForm;
}

export function resolveHarnessEvalWorkerScript(): string {
  return resolveHarnessEvalWorkerScriptFrom(dirname(fileURLToPath(import.meta.url)));
}

export type HarnessEvalWorkerLaunchInput = {
  repo: string;
  pr: number;
  ticket: string;
  expectedHead: string;
  patchDigest: string;
  workerId: string;
  attemptId: string;
};

export type HarnessEvalWorkerLaunch = (input: HarnessEvalWorkerLaunchInput) => void | Promise<void>;

export type HarnessEvalWorkerSpawnHandle = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'spawn', listener: () => void): unknown;
  unref(): unknown;
};

export type HarnessEvalWorkerSpawn = (
  command: string,
  args: readonly string[],
  options: {
    detached: boolean;
    stdio: 'ignore';
    env: typeof process.env;
  },
) => HarnessEvalWorkerSpawnHandle;

export async function defaultHarnessEvalWorkerLaunch(
  input: HarnessEvalWorkerLaunchInput,
  spawnImpl?: HarnessEvalWorkerSpawn,
): Promise<void> {
  const workerScript = resolveHarnessEvalWorkerScript();
  if (!existsSync(workerScript)) {
    throw new Error(`harness eval worker script missing at ${workerScript}`);
  }
  const args = [
    workerScript,
    '--repo',
    input.repo,
    '--pr',
    String(input.pr),
    '--ticket',
    input.ticket,
    '--expected-head',
    input.expectedHead,
    '--patch-digest',
    input.patchDigest,
  ] as const;
  const options = {
    detached: true,
    stdio: 'ignore' as const,
    env: process.env,
  };
  const launchSpawn: HarnessEvalWorkerSpawn =
    spawnImpl ??
    ((command, spawnArgs, spawnOptions) =>
      spawn(command, [...spawnArgs], spawnOptions) as HarnessEvalWorkerSpawnHandle);
  await new Promise<void>((resolveLaunch, reject) => {
    const child = launchSpawn(process.execPath, args, options);
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolveLaunch();
    });
  });
}

export function createProductionHarnessEvalDispatch(
  launch: HarnessEvalWorkerLaunch = defaultHarnessEvalWorkerLaunch,
): HarnessEvalDispatchPort {
  return async (request: HarnessEvalDispatchRequest) => {
    if (
      typeof request.ticket !== 'string' ||
      request.ticket === '' ||
      typeof request.expectedHead !== 'string' ||
      request.expectedHead === ''
    ) {
      throw new Error('ticket and expectedHead are required to launch harness eval');
    }
    await launch({
      repo: request.repo,
      pr: request.pr,
      ticket: request.ticket,
      expectedHead: request.expectedHead,
      patchDigest: request.patchDigest,
      workerId: request.workerId,
      attemptId: request.attemptId,
    });
  };
}

export const productionHarnessEvalDispatch = createProductionHarnessEvalDispatch();

export function productionHarnessEvalConfig(over?: {
  dispatch?: HarnessEvalDispatchPort;
  now?: () => number;
  attemptTimeoutMs?: number;
  dispatchAuthorized?: boolean;
}): {
  dispatch: HarnessEvalDispatchPort;
  attemptTimeoutMs: number;
  now?: () => number;
  dispatchAuthorized: boolean;
} {
  return {
    dispatch: over?.dispatch ?? productionHarnessEvalDispatch,
    attemptTimeoutMs: over?.attemptTimeoutMs ?? DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS,
    ...(over?.now !== undefined ? { now: over.now } : {}),
    dispatchAuthorized: over?.dispatchAuthorized ?? true,
  };
}
