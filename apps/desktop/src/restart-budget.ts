export interface RestartBudget {
  started: () => void;
  exited: () => boolean;
  reset: () => void;
}

export function createRestartBudget(
  max: number,
  stableMs: number,
  now: () => number = Date.now,
): RestartBudget {
  let used = 0;
  let startedAt = 0;
  return {
    started: () => {
      startedAt = now();
    },
    exited: () => {
      if (now() - startedAt >= stableMs) used = 0;
      if (used >= max) return false;
      used += 1;
      return true;
    },
    reset: () => {
      used = 0;
    },
  };
}
