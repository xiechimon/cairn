import type {
  PatchRoutingRuleBody,
  PatchWorkPolicyBody,
  PolicyUse,
  RouteUse,
  RoutingRuleRecord,
  TeamRoutingSettings,
  WorkPolicyRecord,
} from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const ROUTING_SETTINGS_KEY = 'routing-settings';

export function routingRuleInvalidateKeys(
  teamId: string,
  use: RouteUse,
): ReadonlyArray<readonly unknown[]> {
  const keys: Array<readonly unknown[]> = [[ROUTING_SETTINGS_KEY, teamId]];
  if (use === 'coordinator') keys.push(['chief', teamId]);
  return keys;
}

export function useRoutingSettings(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: [ROUTING_SETTINGS_KEY, teamId],
    queryFn: () => api.get<TeamRoutingSettings>(`/api/teams/${teamId}/routing-settings`),
    enabled: live && teamId !== undefined,
  });
}

export function useRoutingSettingsMutations(teamId: string | undefined) {
  const client = useQueryClient();
  const key = [ROUTING_SETTINGS_KEY, teamId] as const;
  const invalidate = () => client.invalidateQueries({ queryKey: key });
  return {
    patchRule: useMutation({
      mutationFn: ({ use, body }: { use: RouteUse; body: PatchRoutingRuleBody }) =>
        api.patch<RoutingRuleRecord>(`/api/teams/${teamId}/routing-rules/${use}`, body),
      onSuccess: (_data, vars) => {
        if (teamId === undefined) {
          void invalidate();
          return;
        }
        for (const queryKey of routingRuleInvalidateKeys(teamId, vars.use)) {
          void client.invalidateQueries({ queryKey });
        }
      },
    }),
    patchPolicy: useMutation({
      mutationFn: ({ use, body }: { use: PolicyUse; body: PatchWorkPolicyBody }) =>
        api.patch<WorkPolicyRecord>(`/api/teams/${teamId}/work-policies/${use}`, body),
      onSuccess: () => invalidate(),
    }),
  };
}
