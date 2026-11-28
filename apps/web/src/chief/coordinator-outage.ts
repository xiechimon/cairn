import type { ChiefOutage, ChiefThread } from '@cairn/shared';
import type { QueueWait } from '../fixtures/records.js';

export function resolveCoordinatorOutage(
  outage: ChiefOutage | null | undefined,
  coordinator: Pick<ChiefThread, 'turnQueue'> | null | undefined,
): ChiefOutage | null {
  if (outage != null) return outage;
  const queue = coordinator?.turnQueue;
  if (queue == null) return null;
  const kind = queue.blocked?.kind;
  if (kind === 'claude-rate-limited') return { reason: 'quota', model: null, retryAt: null };
  if (
    kind === 'claude-logged-out' ||
    kind === 'devin-subscription' ||
    kind === 'antigravity-subscription' ||
    kind === 'doubao-subscription' ||
    kind === 'coordinator-provider-missing' ||
    kind === 'coordinator-provider-no-key'
  ) {
    return { reason: 'subscription', model: null, retryAt: null };
  }
  if (kind === 'machine-offline' || kind === 'no-computer') {
    return { reason: 'runner-offline', model: null, retryAt: null };
  }
  return null;
}

export interface RunnerOfflineCard {
  machineName: string;
  backAt: number | null;
}

export function resolveCoordinatorNotice(
  outage: ChiefOutage | null,
  queueWait: QueueWait | null,
  cards: readonly RunnerOfflineCard[],
  outageMachines: readonly string[] = [],
): { outage: ChiefOutage | null; queueWait: QueueWait | null } {
  if (outage?.reason !== 'runner-offline') return { outage, queueWait };
  const covered = outageMachines.find((machine) =>
    cards.some((card) => card.backAt === null && card.machineName === machine),
  );
  if (covered === undefined) return { outage, queueWait };
  const waitIsCovered =
    queueWait === null || queueWait.machine === undefined || queueWait.machine === covered;
  return { outage: null, queueWait: waitIsCovered ? null : queueWait };
}
