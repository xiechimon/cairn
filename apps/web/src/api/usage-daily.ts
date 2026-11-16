import type { DailyUsage } from '@cairn/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client.js';

export function useDailyUsage(teamId: string | undefined, days: number, tz: string, live: boolean) {
  return useQuery({
    queryKey: ['usage-daily', teamId, days, tz],
    queryFn: () =>
      api.get<DailyUsage>(
        `/api/teams/${teamId}/usage/daily?${new URLSearchParams({ days: String(days), tz })}`,
      ),
    enabled: live && teamId !== undefined,
    refetchOnWindowFocus: true,
  });
}
