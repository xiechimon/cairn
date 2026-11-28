import type {
  CreateDoubaoSubscription,
  DoubaoLoginSession,
  DoubaoRunnerLogin,
  DoubaoSubscription,
  DoubaoSubscriptionListEntry,
  DoubaoSubscriptionVerifyResult,
  ProviderFailure,
  StartDoubaoLoginBody,
} from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  runVerification,
  VERIFY_TIMEOUT_MS,
  type Verification,
  type VerifyOutcome,
} from './account-verification.js';
import type { SubscriptionAccount, SubscriptionModel } from './claude-accounts.js';
import { api } from './client.js';
import { MODEL_ROUTING_KEY } from './model-routing.js';

export type {
  CreateDoubaoSubscription,
  DoubaoLoginSession,
  DoubaoRunnerLogin,
  DoubaoSubscription,
  DoubaoSubscriptionListEntry,
  DoubaoSubscriptionVerifyResult,
  StartDoubaoLoginBody,
};

export interface DoubaoLoginSessionResponse {
  session: DoubaoLoginSession | null;
}

export function doubaoLoginQueryKey(teamId: string | undefined, machineId: string) {
  return ['doubao-login', teamId, machineId] as const;
}

export function useDoubaoLoginSession(
  teamId: string | undefined,
  machineId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: doubaoLoginQueryKey(teamId, machineId ?? ''),
    queryFn: () =>
      api.get<DoubaoLoginSessionResponse>(
        `/api/teams/${teamId}/machines/${machineId}/doubao-login`,
      ),
    enabled: enabled && teamId !== undefined && machineId !== undefined && machineId !== '',
  });
}

export function useStartDoubaoLogin(teamId: string | undefined, machineId: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '发起豆包扫码登录' },
    mutationFn: (body: StartDoubaoLoginBody = {}) =>
      api.post<DoubaoLoginSessionResponse>(
        `/api/teams/${teamId}/machines/${machineId}/doubao-login`,
        body,
      ),
    gcTime: 0,
    onSuccess: (data) => {
      client.setQueryData(doubaoLoginQueryKey(teamId, machineId), data);
    },
  });
}

export function useCancelDoubaoLogin(teamId: string | undefined, machineId: string) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '取消豆包扫码登录' },
    mutationFn: (loginId?: string) => {
      const qs =
        loginId !== undefined && loginId !== '' ? `?loginId=${encodeURIComponent(loginId)}` : '';
      return api.del<DoubaoLoginSessionResponse>(
        `/api/teams/${teamId}/machines/${machineId}/doubao-login${qs}`,
      );
    },
    gcTime: 0,
    onSuccess: (data, requestedLoginId) => {
      const key = doubaoLoginQueryKey(teamId, machineId);
      if (
        data.session !== null &&
        requestedLoginId !== undefined &&
        requestedLoginId !== '' &&
        data.session.loginId !== requestedLoginId
      ) {
        client.setQueryData<DoubaoLoginSessionResponse>(key, (prev) => {
          const prevSession = prev?.session;
          const preservedQr =
            prevSession !== null &&
            prevSession !== undefined &&
            prevSession.loginId === data.session!.loginId &&
            prevSession.qrPngBase64 !== undefined
              ? prevSession.qrPngBase64
              : undefined;
          return {
            session:
              preservedQr !== undefined && data.session!.qrPngBase64 === undefined
                ? { ...data.session!, qrPngBase64: preservedQr }
                : data.session!,
          };
        });
        return;
      }
      client.setQueryData(key, data);
    },
  });
}

export interface DoubaoSubscriptionsResponse {
  subscriptions: DoubaoSubscriptionListEntry[];
  runnerLogins: DoubaoRunnerLogin[];
}

function toDoubaoRunnerLogin(entry: DoubaoRunnerLogin) {
  return {
    runnerId: entry.runnerId,
    name: entry.name,
    online: entry.online,
    status:
      entry.status === 'ok' || entry.status === 'missing_local_login'
        ? entry.status
        : ('unavailable' as const),
  };
}

export function toDoubaoAccount(wire: DoubaoSubscriptionListEntry): SubscriptionAccount {
  return {
    id: wire.id,
    vendor: 'doubao',
    label: wire.label,
    enabled: wire.enabled,
    expiresAt: null,
    createdAt: wire.createdAt,
    plan: null,
    state: 'ok',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: wire.lastUsedAt ?? null,
    stepsLast24h: typeof wire.stepsLast24h === 'number' ? wire.stepsLast24h : null,
    models: Array.isArray(wire.models) ? wire.models : [],
    hasToken: false,
    runnerId: wire.runnerId,
    ...(wire.runnerName !== undefined ? { runnerName: wire.runnerName } : {}),
    ...(wire.runnerLogin !== undefined
      ? {
          runnerLogin:
            wire.runnerLogin === 'ok' || wire.runnerLogin === 'missing_local_login'
              ? wire.runnerLogin
              : ('unavailable' as const),
        }
      : {}),
    ...(wire.runnerModels !== undefined ? { runnerModels: wire.runnerModels } : {}),
    ...(wire.runnerLogins !== undefined
      ? {
          runnerLogins: wire.runnerLogins.map(toDoubaoRunnerLogin),
          doubaoRunnerLogins: wire.runnerLogins,
        }
      : {}),
    ...(wire.runnerOffline === true ? { runnerOffline: true } : {}),
  };
}

export function useDoubaoSubscriptions(teamId: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['doubao-subscriptions', teamId],
    queryFn: () =>
      api.get<DoubaoSubscriptionsResponse>(`/api/teams/${teamId}/doubao-subscriptions`),
    enabled: live && teamId !== undefined,
  });
}

export function useCreateDoubaoSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '添加豆包订阅' },
    mutationFn: (body: CreateDoubaoSubscription) =>
      api.post<DoubaoSubscription>(`/api/teams/${teamId}/doubao-subscriptions`, body),
    gcTime: 0,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
  });
}

export function useEnableDoubaoSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '启用豆包订阅' },
    mutationFn: (id: string) =>
      api.post<DoubaoSubscription>(`/api/teams/${teamId}/doubao-subscriptions/${id}/enable`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
  });
}

export function useDisableDoubaoSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '停用豆包订阅' },
    mutationFn: (id: string) =>
      api.post<DoubaoSubscription>(`/api/teams/${teamId}/doubao-subscriptions/${id}/disable`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
  });
}

export function useDeleteDoubaoSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '移除豆包订阅' },
    mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/doubao-subscriptions/${id}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
  });
}

export function useRenameDoubaoSubscription(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '重命名订阅' },
    mutationFn: (input: { id: string; label: string }) =>
      api.patch<DoubaoSubscription>(`/api/teams/${teamId}/doubao-subscriptions/${input.id}`, {
        label: input.label,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] }),
  });
}

export function useUpdateDoubaoSubscriptionModels(teamId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    meta: { action: '更新订阅模型' },
    mutationFn: (input: { id: string; models: SubscriptionModel[] }) =>
      api.patch<DoubaoSubscription>(`/api/teams/${teamId}/doubao-subscriptions/${input.id}`, {
        models: input.models,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] });
      void client.invalidateQueries({ queryKey: ['model-sources', teamId] });
      void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
    },
  });
}

export function useDoubaoSubscriptionVerification(teamId: string | undefined) {
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
    opts: { runnerName?: string | null; force?: boolean } = {},
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

    const outcome = await runVerification(
      () =>
        api.post<DoubaoSubscriptionVerifyResult>(
          `/api/teams/${teamId}/doubao-subscriptions/${id}/verify`,
        ),
      VERIFY_TIMEOUT_MS + 15_000,
    );
    if (!isCurrent()) return null;
    await Promise.all([
      client.invalidateQueries({ queryKey: ['doubao-subscriptions', teamId] }),
      client.invalidateQueries({ queryKey: ['model-sources', teamId] }),
      client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] }),
    ]).catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
    if (!isCurrent()) return null;
    active.current.delete(id);
    setStates((current) => {
      const { [id]: _settled, ...rest } = current;
      return { ...rest, [id]: outcome };
    });
    return outcome;
  };

  return { states, verify };
}

export type DoubaoUpstreamModelsResult =
  | { status: 'ok'; models: SubscriptionModel[] }
  | { status: 'failed'; failure: ProviderFailure; httpStatus: number | null }
  | {
      status: 'fallback';
      failure: ProviderFailure;
      httpStatus: number | null;
      models: SubscriptionModel[];
    };

export function fetchDoubaoUpstreamModels(
  teamId: string,
  id: string,
): Promise<DoubaoUpstreamModelsResult> {
  return api.post<DoubaoUpstreamModelsResult>(
    `/api/teams/${teamId}/doubao-subscriptions/${id}/upstream-models`,
  );
}
