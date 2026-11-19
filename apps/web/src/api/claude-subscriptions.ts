import type {
  ClaudeSubscription,
  ClaudeSubscriptionListEntry,
  ClaudeSubscriptionVerifyResult,
  CreateClaudeSubscription,
} from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { runVerification, type Verification, type VerifyOutcome } from './account-verification.js';
import { api } from './client.js';

export function useClaudeSubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['claude-subscriptions', teamId],
    queryFn: () =>
      api.get<ClaudeSubscriptionListEntry[]>(`/api/teams/${teamId}/claude-subscriptions`),
    enabled: live && teamId !== undefined,
  });
}

export function hasUsableClaudeSubscription(
  subscriptions: readonly Pick<ClaudeSubscription, 'enabled' | 'expiresAt'>[] | undefined,
  now: number,
): boolean {
  return (subscriptions ?? []).some(
    (subscription) =>
      subscription.enabled !== false &&
      (subscription.expiresAt === null || subscription.expiresAt > now),
  );
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

export function useRenameClaudeSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string }) =>
      api.patch<ClaudeSubscription>(`/api/teams/${teamId}/claude-subscriptions/${input.id}`, {
        label: input.label,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['claude-subscriptions', teamId] }),
  });
}

export function useSubscriptionVerification(teamId: string | undefined) {
  const [states, setStates] = useState<Record<string, Verification>>({});
  const inFlight = useRef(new Set<string>());
  const verify = async (id: string): Promise<VerifyOutcome | null> => {
    if (inFlight.current.has(id)) return null;
    inFlight.current.add(id);
    setStates((current) => ({ ...current, [id]: { phase: 'verifying' } }));
    const outcome = await runVerification(() =>
      api.post<ClaudeSubscriptionVerifyResult>(
        `/api/teams/${teamId}/claude-subscriptions/${id}/verify`,
      ),
    );
    inFlight.current.delete(id);
    setStates((current) => {
      const { [id]: _settled, ...rest } = current;
      return {
        ...rest,
        [id]: outcome.ok ? { phase: 'passed' } : { phase: 'failed', reason: outcome.reason },
      };
    });
    return outcome;
  };
  return { states, verify };
}
