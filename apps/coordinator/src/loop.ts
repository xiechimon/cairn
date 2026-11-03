import type { MachineDoneBody } from '@cairn/shared';
import type { MachineApi } from './machine-api.js';

export interface LoopDeps {
  api: MachineApi;
  runTurn: (
    claimed: NonNullable<Awaited<ReturnType<MachineApi['claim']>>>,
  ) => Promise<MachineDoneBody>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  stopped: () => boolean;
}

export async function claimLoop(deps: LoopDeps): Promise<void> {
  let backoffMs = 1000;
  while (!deps.stopped()) {
    try {
      const claimed = await deps.api.claim();
      backoffMs = 1000;
      if (claimed === null) continue;
      deps.log(`turn ${claimed.step.id} claimed`);
      const result = await deps.runTurn(claimed);
      deps.log(
        `turn ${claimed.step.id} ${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ''}`,
      );
    } catch (error) {
      deps.log(`claim loop error: ${error instanceof Error ? error.message : String(error)}`);
      await deps.sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
}
