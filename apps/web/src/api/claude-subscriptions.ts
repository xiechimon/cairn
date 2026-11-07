import type {
  ClaudeSubscription,
  ClaudeSubscriptionVerifyResult,
  CreateClaudeSubscription,
} from '@cairn/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { runVerification, type Verification, type VerifyOutcome } from './account-verification.js';
import type { AccountStepsPage, ClaudeSubscriptionWire, StickyThread } from './claude-accounts.js';
import { ApiError, api } from './client.js';

async function unlessMissing<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function useClaudeSubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['claude-subscriptions', teamId],
    queryFn: () => api.get<ClaudeSubscriptionWire[]>(`/api/teams/${teamId}/claude-subscriptions`),
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

export function useClaudeSubscriptionSteps(
  teamId: string | undefined,
  ids: readonly string[],
  live: boolean,
) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['claude-subscription-steps', teamId, id],
      queryFn: () =>
        unlessMissing(
          api.get<AccountStepsPage>(
            `/api/teams/${teamId}/claude-subscriptions/${id}/steps?limit=20`,
          ),
        ),
      enabled: live && teamId !== undefined,
    })),
  });
}

export function useClaudeSubscriptionStickiness(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['claude-subscription-stickiness', teamId],
    queryFn: () =>
      unlessMissing(
        api.get<{ threads: StickyThread[] }>(
          `/api/teams/${teamId}/claude-subscriptions/stickiness`,
        ),
      ),
    enabled: live && teamId !== undefined,
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
      return outcome.ok ? rest : { ...rest, [id]: { phase: 'failed', reason: outcome.reason } };
    });
    return outcome;
  };
  return { states, verify };
}
