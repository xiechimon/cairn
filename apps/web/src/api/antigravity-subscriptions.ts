import type {
  AntigravitySubscription,
  AntigravitySubscriptionListEntry,
  AntigravitySubscriptionVerifyResult,
  CreateAntigravitySubscription,
  MachineRecord,
  ProviderFailure,
} from '@cairn/shared';
import { antigravityKeyFromText } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  runVerification,
  VERIFY_TIMEOUT_MS,
  type Verification,
  type VerifyOutcome,
} from './account-verification.js';
import type { SubscriptionAccount, SubscriptionModel } from './claude-accounts.js';
import { ApiError, api } from './client.js';
import { MODEL_ROUTING_KEY } from './model-routing.js';

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
    models: Array.isArray(wire.models) ? wire.models : [],
    hasToken: wire.hasToken,
    ...(wire.runnerId !== undefined ? { runnerId: wire.runnerId } : {}),
    ...(wire.runnerName !== undefined ? { runnerName: wire.runnerName } : {}),
    runnerLogin: wire.runnerLogin,
    ...(wire.runnerModels !== undefined ? { runnerModels: wire.runnerModels } : {}),
    ...(wire.runnerLogins !== undefined ? { runnerLogins: wire.runnerLogins } : {}),
    ...(wire.runnerOffline === true ? { runnerOffline: true } : {}),
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

const HOST_LOGIN_RETRY_MS = 12_000;
const HOST_LOGIN_RETRY_ATTEMPTS = 3;
const HOST_LOGIN_VERIFY_TIMEOUT_MS =
  VERIFY_TIMEOUT_MS + HOST_LOGIN_RETRY_ATTEMPTS * HOST_LOGIN_RETRY_MS + 15_000;

export function useCreateAntigravitySubscription(teamId: string | undefined) {
  return useMutation({
    mutationFn: (body: CreateAntigravitySubscription) =>
      api.post<AntigravitySubscription>(`/api/teams/${teamId}/antigravity-subscriptions`, body),
    gcTime: 0,
  });
}

export function useDeleteAntigravitySubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<void>(`/api/teams/${teamId}/antigravity-subscriptions/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
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

export interface AntigravityVerifyOptions {
  runnerId?: string;
  runnerName?: string | null;
  retryOnMissingLogin?: boolean;
  force?: boolean;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function useAntigravitySubscriptionVerification(teamId: string | undefined) {
  const client = useQueryClient();
  const [states, setStates] = useState<Record<string, Verification>>({});
  const active = useRef(new Map<string, { controller: AbortController; generation: number }>());
  const nextGeneration = useRef(0);

  useEffect(
    () => () => {
      for (const entry of active.current.values()) entry.controller.abort();
      active.current.clear();
    },
    [],
  );

  const verify = async (
    id: string,
    opts: AntigravityVerifyOptions = {},
  ): Promise<VerifyOutcome | null> => {
    const existing = active.current.get(id);
    if (existing !== undefined && opts.force !== true) return null;
    existing?.controller.abort();
    const controller = new AbortController();
    const generation = ++nextGeneration.current;
    active.current.set(id, { controller, generation });
    const isCurrent = () => active.current.get(id)?.generation === generation;

    setStates((current) => ({
      ...current,
      [id]: {
        phase: 'verifying',
        ...(opts.runnerName != null ? { runnerName: opts.runnerName } : {}),
      },
    }));
    const retryOnMissingLogin = opts.retryOnMissingLogin === true;
    const outcome = await runVerification(
      async () => {
        if (opts.runnerId !== undefined) {
          await api.patch<AntigravitySubscription>(
            `/api/teams/${teamId}/antigravity-subscriptions/${id}`,
            { runnerId: opts.runnerId },
          );
          if (controller.signal.aborted) return { ok: false, reason: 'unavailable' };
        }
        const post = () =>
          api.post<AntigravitySubscriptionVerifyResult>(
            `/api/teams/${teamId}/antigravity-subscriptions/${id}/verify`,
          );
        let result: AntigravitySubscriptionVerifyResult | null = null;
        for (let attempt = 0; ; attempt++) {
          let retryableRateLimit = false;
          try {
            result = await post();
          } catch (error) {
            if (
              retryOnMissingLogin &&
              attempt < HOST_LOGIN_RETRY_ATTEMPTS &&
              error instanceof ApiError &&
              error.status === 429
            ) {
              retryableRateLimit = true;
            } else {
              throw error;
            }
          }
          if (controller.signal.aborted) {
            return result ?? { ok: false, reason: 'unavailable' };
          }
          const shouldRetry =
            retryOnMissingLogin &&
            attempt < HOST_LOGIN_RETRY_ATTEMPTS &&
            (retryableRateLimit ||
              (result !== null && !result.ok && result.reason === 'missing_local_login'));
          if (!shouldRetry) return result ?? { ok: false, reason: 'failed' };
          const waited = await abortableSleep(HOST_LOGIN_RETRY_MS, controller.signal);
          if (!waited) return result ?? { ok: false, reason: 'unavailable' };
        }
      },
      retryOnMissingLogin ? HOST_LOGIN_VERIFY_TIMEOUT_MS : VERIFY_TIMEOUT_MS,
    );
    if (!isCurrent()) return null;
    await Promise.all([
      client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] }),
      client.invalidateQueries({ queryKey: ['model-sources', teamId] }),
      client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] }),
    ]).catch(() => {});
    if (!isCurrent()) return null;
    active.current.delete(id);
    setStates((current) => {
      const { [id]: _settled, ...rest } = current;
      return {
        ...rest,
        [id]: outcome,
      };
    });
    return outcome;
  };
  return { states, verify };
}

export type AntigravityUpstreamModelsResult =
  | { status: 'ok'; models: SubscriptionModel[] }
  | { status: 'failed'; failure: ProviderFailure; httpStatus: number | null }
  | {
      status: 'fallback';
      failure: ProviderFailure;
      httpStatus: number | null;
      models: SubscriptionModel[];
    };

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
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
  });
}

export interface AntigravityRunnerTarget {
  isThisComputer: boolean;
  label: string | null;
}

export interface RunnerTargetMachine {
  id: string;
  name: string;
  kind?: MachineRecord['kind'];
  online: boolean;
  capabilities?: { computerName?: string; hostname?: string } | null;
}

export function defaultRunnerTarget(
  machines: readonly RunnerTargetMachine[] | undefined,
  defaultMachineId: string | null | undefined,
  localRunnerId?: string,
): AntigravityRunnerTarget {
  if (machines === undefined || machines.length === 0) {
    return { isThisComputer: true, label: null };
  }
  const online = machines.filter((machine) => machine.online);
  const runner =
    (defaultMachineId != null
      ? machines.find((machine) => machine.id === defaultMachineId)
      : undefined) ??
    (online.length === 1 ? online[0] : undefined) ??
    (machines.length === 1 ? machines[0] : undefined) ??
    machines.find((machine) => machine.kind === 'local');
  if (runner === undefined) {
    return { isThisComputer: true, label: null };
  }
  const isThisComputer =
    localRunnerId !== undefined ? runner.id === localRunnerId : runner.kind !== 'remote';
  if (isThisComputer) {
    return { isThisComputer: true, label: null };
  }
  const reported = runner.capabilities;
  const label =
    reported?.computerName !== undefined && reported.hostname === runner.name
      ? reported.computerName
      : runner.name;
  return { isThisComputer: false, label };
}
