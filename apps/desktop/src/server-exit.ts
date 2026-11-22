import type { RestartBudget } from './restart-budget.js';

export interface ServerExitHooks<T> {
  isQuitting: () => boolean;
  current: () => T | null;
  gate?: (dead: T, code: number | null) => Promise<boolean>;
  restart: (dead: T, code: number | null) => void;
  fatal: (code: number | null) => void;
}

export function createServerExitHandler<T>(opts: {
  budget: RestartBudget;
  hooks: ServerExitHooks<T>;
}): (dead: T, code: number | null) => void {
  const skip = (dead: T): boolean => opts.hooks.isQuitting() || opts.hooks.current() !== dead;
  const decide = (dead: T, code: number | null): void => {
    if (!opts.budget.exited()) {
      opts.hooks.fatal(code);
      return;
    }
    opts.hooks.restart(dead, code);
  };
  return (dead, code) => {
    if (skip(dead)) return;
    const gate = opts.hooks.gate;
    if (gate === undefined) {
      decide(dead, code);
      return;
    }
    void (async () => {
      if (await gate(dead, code)) return;
      if (skip(dead)) return;
      decide(dead, code);
    })();
  };
}
