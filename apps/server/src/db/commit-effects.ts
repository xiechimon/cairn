import type { ConversationStreamHub, TeamStreamHub } from '../services/events.js';
import type { MachineWakeHub } from '../services/machine-wake-hub.js';
import type { Db } from './client.js';

export interface EffectHubs {
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  convHub?: ConversationStreamHub;
}

export type ScheduleEffect = (name: string, run: () => void) => void;
type DeferSignals = (hubs: EffectHubs, schedule: ScheduleEffect) => EffectHubs;

export interface CommitEffects {
  commitEffects?: {
    hubs: EffectHubs;
    schedule: ScheduleEffect;
    defer: DeferSignals | undefined;
  };
}

export function runAfterCommit(deps: CommitEffects, name: string, run: () => void): void {
  if (deps.commitEffects === undefined) run();
  else deps.commitEffects.schedule(name, run);
}

export function withCommitEffects<D extends EffectHubs & CommitEffects & { db: Db }, T>(
  deps: D,
  run: (deps: NoInfer<D>) => T,
  defer = deps.commitEffects?.defer,
): T {
  const effects: { name: string; run: () => void }[] = [];
  const schedule: ScheduleEffect = (name, run) => effects.push({ name, run });
  const hubs = deps.commitEffects?.hubs ?? deps;
  const result = deps.db.transaction(
    () =>
      run({
        ...deps,
        ...defer?.(hubs, schedule),
        commitEffects: { hubs, schedule, defer },
      }),
    { behavior: 'immediate' },
  );
  for (const effect of effects) {
    if (deps.commitEffects !== undefined) {
      deps.commitEffects.schedule(effect.name, effect.run);
    } else {
      try {
        effect.run();
      } catch (error) {
        console.error('post-commit effect failed', { effect: effect.name, error });
      }
    }
  }
  return result;
}
