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
    seed: useMutation({
      mutationFn: () => api.post<TeamRoutingSettings>(`/api/teams/${teamId}/routing-settings/seed`),
      onSuccess: (data) => {
        client.setQueryData(key, data);
      },
    }),
    patchRule: useMutation({
      mutationFn: ({ use, body }: { use: RouteUse; body: PatchRoutingRuleBody }) =>
        api.patch<RoutingRuleRecord>(`/api/teams/${teamId}/routing-rules/${use}`, body),
      onSuccess: () => invalidate(),
    }),
    patchPolicy: useMutation({
      mutationFn: ({ use, body }: { use: PolicyUse; body: PatchWorkPolicyBody }) =>
        api.patch<WorkPolicyRecord>(`/api/teams/${teamId}/work-policies/${use}`, body),
      onSuccess: () => invalidate(),
    }),
  };
}
