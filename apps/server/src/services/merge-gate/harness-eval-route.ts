import type {
  ClaimAttemptInput,
  ClaimAttemptResult,
  HarnessEvalAttempt,
} from '../harness-eval-coordinator.js';

export type HarnessEvalNeed = 'missing' | 'stale';

export type HarnessEvalCoordinatorPort = {
  claimAttempt(input: ClaimAttemptInput): Promise<ClaimAttemptResult>;
  getAttempt(input: ClaimAttemptInput): HarnessEvalAttempt | null;
  reconcile(now?: number): { timedOut: string[] };
};

export type PrepareHarnessEvalInput = {
  coordinator: HarnessEvalCoordinatorPort;
  repo: string;
  pr: number;
  patchDigest: string;
  need: HarnessEvalNeed | null;
  dispatchAuthorized: boolean;
};

export type PrepareHarnessEvalResult = {
  attempt: HarnessEvalAttempt | null;
  created: boolean;
  dispatched: boolean;
};

export type LiveHarnessAttemptView = {
  state: string;
  deadlineAt?: number;
  patchDigest?: string;
  workerId?: string;
  id?: string;
};

export type LiveHarnessBinding = {
  now: number;
  patchDigest: string;
};

const LIVE = new Set(['claimed', 'dispatched', 'dispatch_uncertain']);

export function isLiveHarnessAttempt(
  attempt: LiveHarnessAttemptView | null | undefined,
  binding: LiveHarnessBinding,
): boolean {
  if (attempt == null || !LIVE.has(attempt.state)) return false;
  if (typeof attempt.deadlineAt !== 'number' || attempt.deadlineAt <= binding.now) return false;
  if (attempt.patchDigest !== binding.patchDigest) return false;
  return true;
}

export async function prepareHarnessEvalRouting(
  input: PrepareHarnessEvalInput,
): Promise<PrepareHarnessEvalResult> {
  input.coordinator.reconcile();
  const key = {
    repo: input.repo,
    pr: input.pr,
    patchDigest: input.patchDigest,
  };
  if (input.need === null) {
    return {
      attempt: input.coordinator.getAttempt(key),
      created: false,
      dispatched: false,
    };
  }
  if (!input.dispatchAuthorized) {
    return {
      attempt: input.coordinator.getAttempt(key),
      created: false,
      dispatched: false,
    };
  }
  const claimed = await input.coordinator.claimAttempt(key);
  return {
    attempt: claimed.attempt,
    created: claimed.created,
    dispatched: claimed.dispatched,
  };
}
