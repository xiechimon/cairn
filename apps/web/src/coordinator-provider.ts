import type { TeamRoutingSettings } from '@cairn/shared';

export function coordinatorProviderOf(settings: TeamRoutingSettings | undefined): string | null {
  if (settings === undefined) return null;
  const rule = settings.rules.find((entry) => entry.use === 'coordinator');
  return rule?.provider ?? settings.coordinatorDefault?.provider ?? null;
}
