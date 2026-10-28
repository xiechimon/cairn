import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HarnessEvalDispatchPort,
  HarnessEvalDispatchRequest,
} from './harness-eval-coordinator.js';

export const DEFAULT_HARNESS_EVAL_ATTEMPT_TIMEOUT_MS = 60 * 60 * 1000;

const WORKER_SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../scripts/harness-eval-worker.mjs',
);

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

export async function defaultHarnessEvalWorkerLaunch(
  input: HarnessEvalWorkerLaunchInput,
): Promise<void> {
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(
      process.execPath,
      [
        WORKER_SCRIPT,
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
      ],
      {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
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
