import type {
  CreateDevinSubscription,
  DevinSubscription,
  DevinSubscriptionVerifyResult,
} from '@cairn/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { runVerification, type Verification, type VerifyOutcome } from './account-verification.js';
import {
  ACCOUNT_STATES,
  type AccountPlan,
  type AccountState,
  type AccountStepsPage,
  type QuotaWindow,
  type SubscriptionAccount,
} from './claude-accounts.js';
import { ApiError, api } from './client.js';

export type { CreateDevinSubscription, DevinSubscription, DevinSubscriptionVerifyResult };

export type DevinSubscriptionWire = DevinSubscription & {
  plan?: AccountPlan | null;
  state?: AccountState;
  cooldownUntil?: number | null;
  windows?: QuotaWindow[];
  lastUsedAt?: number | null;
  stepsLast24h?: number;
};

const isAccountState = (value: unknown): value is AccountState =>
  typeof value === 'string' && (ACCOUNT_STATES as readonly string[]).includes(value);

export function toDevinAccount(wire: DevinSubscriptionWire, now: number): SubscriptionAccount {
  const expired = wire.expiresAt !== null && wire.expiresAt <= now;
  return {
    id: wire.id,
    vendor: 'devin',
    label: wire.label,
    expiresAt: wire.expiresAt,
    createdAt: wire.createdAt,
    plan: null,
    state: isAccountState(wire.state) ? wire.state : expired ? 'expired' : 'ok',
    cooldownUntil: wire.cooldownUntil ?? null,
    windows: Array.isArray(wire.windows) ? wire.windows : [],
    lastUsedAt: wire.lastUsedAt ?? null,
    stepsLast24h: typeof wire.stepsLast24h === 'number' ? wire.stepsLast24h : null,
  };
}

async function unlessMissing<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function useDevinSubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['devin-subscriptions', teamId],
    queryFn: () => api.get<DevinSubscriptionWire[]>(`/api/teams/${teamId}/devin-subscriptions`),
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

export function useDevinSubscriptionSteps(
  teamId: string | undefined,
  ids: readonly string[],
  live: boolean,
) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['devin-subscription-steps', teamId, id],
      queryFn: () =>
        unlessMissing(
          api.get<AccountStepsPage>(`/api/teams/${teamId}/devin-subscriptions/${id}/steps?limit=20`),
        ),
      enabled: live && teamId !== undefined,
    })),
  });
}

export function useDevinSubscriptionVerification(teamId: string | undefined) {
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
      return outcome.ok ? rest : { ...rest, [id]: { phase: 'failed', reason: outcome.reason } };
    });
    return outcome;
  };
  return { states, verify };
}
