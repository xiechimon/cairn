import type {
  CreateDevinSubscription,
  DevinSubscription,
  DevinSubscriptionListEntry,
  DevinSubscriptionVerifyResult,
  ProviderFailure,
} from '@cairn/shared';
import { devinKeyFromToml } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { runVerification, type Verification, type VerifyOutcome } from './account-verification.js';
import type { SubscriptionAccount, SubscriptionModel } from './claude-accounts.js';
import { api } from './client.js';

export type { CreateDevinSubscription, DevinSubscription, DevinSubscriptionVerifyResult };

export function extractDevinToken(input: string): string {
  const trimmed = input.trim();
  return devinKeyFromToml(trimmed) ?? trimmed;
}

export function toDevinAccount(wire: DevinSubscriptionListEntry, now: number): SubscriptionAccount {
  const expired = wire.expiresAt !== null && wire.expiresAt <= now;
  return {
    id: wire.id,
    vendor: 'devin',
    label: wire.label,
    expiresAt: wire.expiresAt,
    createdAt: wire.createdAt,
    plan: null,
    state: expired ? 'expired' : 'ok',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: wire.lastUsedAt ?? null,
    stepsLast24h: typeof wire.stepsLast24h === 'number' ? wire.stepsLast24h : null,
    models: Array.isArray(wire.models) ? wire.models : [],
  };
}

export function useDevinSubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['devin-subscriptions', teamId],
    queryFn: () =>
      api.get<DevinSubscriptionListEntry[]>(`/api/teams/${teamId}/devin-subscriptions`),
    enabled: live && teamId !== undefined,
  });
}

export function hasUsableDevinSubscription(
  subscriptions: readonly Pick<DevinSubscription, 'enabled' | 'expiresAt'>[] | undefined,
  now: number,
): boolean {
  return (subscriptions ?? []).some(
    (subscription) =>
      subscription.enabled !== false &&
      (subscription.expiresAt === null || subscription.expiresAt > now),
  );
}

export function useCreateDevinSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDevinSubscription) =>
      api.post<DevinSubscription>(`/api/teams/${teamId}/devin-subscriptions`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['devin-subscriptions', teamId] }),
    gcTime: 0,
  });
}

export function useDeleteDevinSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/devin-subscriptions/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['devin-subscriptions', teamId] }),
  });
}

export function useRenameDevinSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; label: string }) =>
      api.patch<DevinSubscription>(`/api/teams/${teamId}/devin-subscriptions/${input.id}`, {
        label: input.label,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['devin-subscriptions', teamId] }),
  });
}

export type DevinUpstreamModelsResult =
  | { status: 'ok'; models: SubscriptionModel[] }
  | { status: 'failed'; failure: ProviderFailure; httpStatus: number | null };

export function fetchDevinUpstreamModels(
  teamId: string,
  id: string,
): Promise<DevinUpstreamModelsResult> {
  return api.post<DevinUpstreamModelsResult>(
    `/api/teams/${teamId}/devin-subscriptions/${id}/upstream-models`,
  );
}

export function useUpdateDevinSubscriptionModels(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; models: SubscriptionModel[] }) =>
      api.patch<DevinSubscription>(`/api/teams/${teamId}/devin-subscriptions/${input.id}`, {
        models: input.models,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['devin-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
    },
  });
}

export function useDevinSubscriptionVerification(teamId: string | undefined) {
  const client = useQueryClient();
  const [states, setStates] = useState<Record<string, Verification>>({});
  const inFlight = useRef(new Set<string>());
  const verify = async (id: string): Promise<VerifyOutcome | null> => {
    if (inFlight.current.has(id)) return null;
    inFlight.current.add(id);
    setStates((current) => ({ ...current, [id]: { phase: 'verifying' } }));
    const outcome = await runVerification(() =>
      api.post<DevinSubscriptionVerifyResult>(
        `/api/teams/${teamId}/devin-subscriptions/${id}/verify`,
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
    void client.invalidateQueries({ queryKey: ['devin-subscriptions', teamId] });
    return outcome;
  };
  return { states, verify };
}
