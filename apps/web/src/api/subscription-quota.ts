import type { SubscriptionQuota } from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import type { AccountVendor } from './claude-accounts.js';
import { api } from './client.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  );
}

function isCountPair(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.runs === 'number' &&
    Number.isSafeInteger(value.runs) &&
    value.runs >= 0 &&
    typeof value.limited === 'number' &&
    Number.isSafeInteger(value.limited) &&
    value.limited >= 0 &&
    value.limited <= value.runs
  );
}

function isSubscriptionQuota(value: unknown): value is SubscriptionQuota {
  if (!isRecord(value) || !Array.isArray(value.windows) || !isRecord(value.activity)) return false;
  return (
    value.windows.every(
      (window: unknown) =>
        isRecord(window) &&
        typeof window.name === 'string' &&
        window.name.trim().length > 0 &&
        typeof window.utilization === 'number' &&
        Number.isFinite(window.utilization) &&
        window.utilization >= 0 &&
        isTimestamp(window.observedAt) &&
        (window.resetsAt === null || isTimestamp(window.resetsAt)),
    ) &&
    isCountPair(value.activity.fiveHour) &&
    isCountPair(value.activity.sevenDay) &&
    (value.activity.resetsAt === null || isTimestamp(value.activity.resetsAt))
  );
}

export function useSubscriptionQuota(
  teamId: string,
  kind: AccountVendor,
  id: string,
  revision: string | number | null,
) {
  return useQuery({
    queryKey: ['subscriptionQuota', teamId, kind, id, revision],
    queryFn: async ({ signal }) => {
      const data = await api.get<unknown>(
        `/api/teams/${encodeURIComponent(teamId)}/subscription-quota/${kind}/${encodeURIComponent(id)}`,
        signal,
      );
      if (!isSubscriptionQuota(data)) throw new Error('Invalid subscription quota response');
      return data;
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
