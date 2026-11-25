import type { ChiefOutage, ChiefThread } from '@cairn/shared';

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
