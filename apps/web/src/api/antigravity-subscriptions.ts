import type {
  AntigravitySubscription,
  AntigravitySubscriptionListEntry,
  AntigravitySubscriptionVerifyResult,
  CreateAntigravitySubscription,
  ProviderFailure,
} from '@cairn/shared';
import { antigravityKeyFromText } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { runVerification, type Verification, type VerifyOutcome } from './account-verification.js';
import type { SubscriptionAccount, SubscriptionModel } from './claude-accounts.js';
import { api } from './client.js';

export type {
  AntigravitySubscription,
  AntigravitySubscriptionVerifyResult,
  CreateAntigravitySubscription,
};

export function extractAntigravityToken(input: string): string {
  const trimmed = input.trim();
  return antigravityKeyFromText(trimmed) ?? trimmed;
}

export function toAntigravityAccount(
  wire: AntigravitySubscriptionListEntry,
  now: number,
): SubscriptionAccount {
  const expired = wire.expiresAt !== null && wire.expiresAt <= now;
  return {
    id: wire.id,
    vendor: 'antigravity',
    label: wire.label,
    expiresAt: wire.expiresAt,
    createdAt: wire.createdAt,
    plan: null,
    state: expired ? 'expired' : 'ok',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: wire.lastUsedAt ?? null,
    stepsLast24h: typeof wire.stepsLast24h === 'number' ? wire.stepsLast24h : null,
    lastCheck: wire.lastCheck ?? null,
    models: Array.isArray(wire.models) ? wire.models : [],
  };
}

export function useAntigravitySubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['antigravity-subscriptions', teamId],
    queryFn: () =>
      api.get<AntigravitySubscriptionListEntry[]>(`/api/teams/${teamId}/antigravity-subscriptions`),
    enabled: live && teamId !== undefined,
  });
}

export function hasUsableAntigravitySubscription(
  subscriptions: readonly Pick<AntigravitySubscription, 'enabled' | 'expiresAt'>[] | undefined,
  now: number,
): boolean {
  return (subscriptions ?? []).some(
    (subscription) =>
      subscription.enabled !== false &&
      (subscription.expiresAt === null || subscription.expiresAt > now),
  );
}

export function useCreateAntigravitySubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAntigravitySubscription) =>
      api.post<AntigravitySubscription>(`/api/teams/${teamId}/antigravity-subscriptions`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] }),
    gcTime: 0,
  });
}

export function useDeleteAntigravitySubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<void>(`/api/teams/${teamId}/antigravity-subscriptions/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] }),
  });
}

export function useRenameAntigravitySubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string }) =>
      api.patch<AntigravitySubscription>(
        `/api/teams/${teamId}/antigravity-subscriptions/${input.id}`,
        { label: input.label },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] }),
  });
}

export function useAntigravitySubscriptionVerification(teamId: string | undefined) {
  const client = useQueryClient();
  const [states, setStates] = useState<Record<string, Verification>>({});
  const inFlight = useRef(new Set<string>());
  const verify = async (id: string): Promise<VerifyOutcome | null> => {
    if (inFlight.current.has(id)) return null;
    inFlight.current.add(id);
    setStates((current) => ({ ...current, [id]: { phase: 'verifying' } }));
    const outcome = await runVerification(() =>
      api.post<AntigravitySubscriptionVerifyResult>(
        `/api/teams/${teamId}/antigravity-subscriptions/${id}/verify`,
      ),
    );
    inFlight.current.delete(id);
    setStates((current) => {
      const { [id]: _settled, ...rest } = current;
      return {
        ...rest,
        [id]: outcome,
      };
    });
    void client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] });
    return outcome;
  };
  return { states, verify };
}

export type AntigravityUpstreamModelsResult =
  | { status: 'ok'; models: SubscriptionModel[] }
  | { status: 'failed'; failure: ProviderFailure; httpStatus: number | null };

export function fetchAntigravityUpstreamModels(
  teamId: string,
  id: string,
): Promise<AntigravityUpstreamModelsResult> {
  return api.post<AntigravityUpstreamModelsResult>(
    `/api/teams/${teamId}/antigravity-subscriptions/${id}/upstream-models`,
  );
}

export function useUpdateAntigravitySubscriptionModels(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; models: SubscriptionModel[] }) =>
      api.patch<AntigravitySubscription>(
        `/api/teams/${teamId}/antigravity-subscriptions/${input.id}`,
        { models: input.models },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
    },
  });
}
