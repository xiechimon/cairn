import type { ClaudeSubscription, CreateClaudeSubscription } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export function useClaudeSubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['claude-subscriptions', teamId],
    queryFn: () => api.get<ClaudeSubscription[]>(`/api/teams/${teamId}/claude-subscriptions`),
    enabled: live && teamId !== undefined,
  });
}

export function useCreateClaudeSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateClaudeSubscription) =>
      api.post<ClaudeSubscription>(`/api/teams/${teamId}/claude-subscriptions`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['claude-subscriptions', teamId] }),
    gcTime: 0,
  });
}

export function useDeleteClaudeSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/claude-subscriptions/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['claude-subscriptions', teamId] }),
  });
}
