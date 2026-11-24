import {
  type ManagedUpdateRuntime,
  type ModelSource,
  type ModelSourceModel,
  orderByKeys,
  type ProviderRecord,
  type ProviderTestResult,
  type RoutingConnection,
  type TeamProviderTestResult,
} from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Verification } from '../api/account-verification.js';
import {
  fetchAntigravityUpstreamModels,
  toAntigravityAccount,
  useAntigravitySubscriptions,
  useAntigravitySubscriptionVerification,
  useDeleteAntigravitySubscription,
  useRenameAntigravitySubscription,
  useUpdateAntigravitySubscriptionModels,
} from '../api/antigravity-subscriptions.js';
import {
  type AccountVendor,
  type SubscriptionAccount,
  type SubscriptionModel,
  toClaudeAccount,
} from '../api/claude-accounts.js';
import {
  fetchClaudeUpstreamModels,
  testClaudeSubscriptionModel,
  useClaudeSubscriptions,
  useDeleteClaudeSubscription,
  useRefreshClaudeQuota,
  useRenameClaudeSubscription,
  useSubscriptionVerification,
  useUpdateClaudeSubscriptionModels,
} from '../api/claude-subscriptions.js';
import {
  fetchDevinUpstreamModels,
  toDevinAccount,
  useDeleteDevinSubscription,
  useDevinSubscriptions,
  useDevinSubscriptionVerification,
  useRenameDevinSubscription,
  useUpdateDevinSubscriptionModels,
} from '../api/devin-subscriptions.js';
import {
  type ProvidersEnvelope,
  useApiMutations,
  useModelSources,
  useProviders,
  useSaveProviderOrder,
  useUpdateRuntime,
} from '../api/hooks.js';
import { MODEL_ROUTING_KEY, useModelRouting } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useClock, VENDORS } from '../components/accounts/account-parts.js';
import { EmptyState } from '../components/empty-state.js';
import { type ProviderItem, ProviderPanel } from '../components/providers/provider-panel.js';
import { mergeQueries, QueryBoundary } from '../components/query-state.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { AddProviderFlow, type AddProviderView } from './add-provider-flow.js';
import { AntigravityRelogin } from './antigravity-subscriptions.js';
import {
  applyListResponse,
  initialProviderRefresh,
  issueCheckGeneration,
  needsProviderList,
  type ProviderRefreshState,
  type ProviderRowChecks,
  recordProviderResult,
} from './provider-check-state.js';
import {
  type ProviderEditActions,
  providerKind,
  providerMark,
  TeamProviderEditor,
} from './provider-editors.js';
import {
  providerRowStatus,
  QuotaMark,
  type RuntimeUpdateSummary,
  runtimeUpdateSummary,
  type SubscriptionActions,
  SubscriptionDetail,
  subscriptionModels,
  subscriptionStatusView,
  subscriptionSummary,
  teamProviderStatusView,
} from './subscription-detail.js';
import { groupAntigravityUpstream, groupDevinUpstream } from './upstream-model-groups.js';
import { UpstreamModelPicker } from './upstream-model-picker.js';

const ANTIGRAVITY_FALLBACK_REASONS = {
  auth: '执行机上的 Antigravity 尚未登录，未能获取它的模型清单。请登录后重试。',
  'not-found': '没有已安装 Antigravity 的在线执行机，未能获取它的模型清单。',
} as const;

interface Entry {
  item: ProviderItem;
  editor: ReactNode;
}

const CLAUDE_SUBSCRIPTION_ADD = 'claude-subscription';
const DEVIN_SUBSCRIPTION_ADD = 'devin-subscription';
const ANTIGRAVITY_SUBSCRIPTION_ADD = 'antigravity-subscription';
const SUBSCRIPTION_VIEWS: Record<string, AddProviderView> = {
  [CLAUDE_SUBSCRIPTION_ADD]: 'subscription',
  [DEVIN_SUBSCRIPTION_ADD]: 'devin-subscription',
  [ANTIGRAVITY_SUBSCRIPTION_ADD]: 'antigravity-subscription',
};

const NO_DEAD_MODELS: ReadonlySet<string> = new Set();

function deadModelIds(sources: readonly ModelSource[]): ReadonlyMap<string, ReadonlySet<string>> {
  const dead = new Map<string, Set<string>>();
  for (const source of sources) {
    if (source.runtime !== 'pi' || source.provider === undefined) continue;
    const set = dead.get(source.provider) ?? new Set<string>();
    dead.set(source.provider, set);
    for (const model of source.models) {
      if (model.liveness === 'dead') set.add(model.id);
    }
  }
  return dead;
}

function teamEntries(
  providers: readonly ProviderRecord[],
  dead: ReadonlyMap<string, ReadonlySet<string>>,
  connections: readonly RoutingConnection[],
  checks: ProviderRowChecks,
  geminiUpdate: RuntimeUpdateSummary | null,
  actionsFor: (record: ProviderRecord) => ProviderEditActions,
  t: TFunc,
): Entry[] {
  return providers.map((record) => {
    const deadModels = dead.get(record.providerId) ?? NO_DEAD_MODELS;
    const status = providerRowStatus(
      teamProviderStatusView(record, connections, checks[record.id], t),
      record.models.map((model) => ({
        ...model,
        liveness: deadModels.has(model.id) ? 'dead' : 'alive',
      })),
      t,
    );
    const parts = [t(providerKind(record)), t('{n} 个模型', { n: record.models.length })];
    return {
      item: {
        id: `provider:${record.id}`,
        name: record.label,
        Mark: providerMark(record),
        status: parts.join(' · '),
        ...status,
      },
      editor: (
        <TeamProviderEditor
          key={record.id}
          record={record}
          deadModels={deadModels}
          runtimeUpdate={record.providerId === 'gemini' ? geminiUpdate : null}
          actions={actionsFor(record)}
        />
      ),
    };
  });
}

interface SubscriptionEntryDeps {
  now: number;
  models: readonly ModelSourceModel[];
  runtimeUpdate?: RuntimeUpdateSummary | null;
  verifications: Record<string, Verification>;
  actionsFor: (account: SubscriptionAccount) => SubscriptionActions;
  reloginFor?: (account: SubscriptionAccount) => ReactNode;
  t: TFunc;
  clock: (ts: number, now: number) => string;
}

function subscriptionEntries(
  accounts: readonly SubscriptionAccount[],
  deps: SubscriptionEntryDeps,
): Entry[] {
  return accounts.map((account) => {
    const verification = deps.verifications[account.id];
    const view = subscriptionStatusView(account, deps.now, deps.t, deps.clock);
    const runtimeLiveness = new Map(deps.models.map((model) => [model.id, model.liveness]));
    const runtimeUpdate = new Map(deps.models.map((model) => [model.id, model.updateRequired]));
    const picked = account.models ?? [];
    const shown = (
      picked.length > 0
        ? picked
        : deps.models.map((model): SubscriptionModel => ({ id: model.id, name: model.name }))
    ).map((model) => ({
      ...model,
      liveness: runtimeLiveness.get(model.id) === 'dead' ? ('dead' as const) : model.liveness,
      updateRequired: runtimeUpdate.get(model.id),
    }));
    const status = providerRowStatus(view, shown, deps.t);
    return {
      item: {
        id: `subscription:${account.id}`,
        name: account.label,
        Mark: VENDORS[account.vendor].Mark,
        status: subscriptionSummary(shown.length, deps.t),
        ...status,
        aside: <QuotaMark windows={account.windows} />,
      },
      editor: (
        <SubscriptionDetail
          key={account.id}
          account={account}
          models={shown}
          now={deps.now}
          view={view}
          verification={verification}
          runtimeUpdate={deps.runtimeUpdate ?? null}
          actions={deps.actionsFor(account)}
          relogin={deps.reloginFor?.(account)}
        />
      ),
    };
  });
}

const SAMPLE_TEST_RESULT: ProviderTestResult = {
  status: 'ok',
  reason: null,
  failure: null,
  httpStatus: 200,
  detail: null,
  latencyMs: 420,
};

export function ProvidersSection() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const sourcesQ = useModelSources(teamId, live);
  const providersQ = useProviders(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const mutations = useApiMutations(teamId);
  const client = useQueryClient();
  const clock = useClock();
  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const refreshQuota = useRefreshClaudeQuota(teamId).mutate;
  const devinSubscriptionsQ = useDevinSubscriptions(teamId, live);
  const antigravitySubscriptionsQ = useAntigravitySubscriptions(teamId, live);
  const deleteSubscription = useDeleteClaudeSubscription(teamId);
  const deleteDevinSubscription = useDeleteDevinSubscription(teamId);
  const deleteAntigravitySubscription = useDeleteAntigravitySubscription(teamId);
  const renameSubscription = useRenameClaudeSubscription(teamId);
  const renameDevinSubscription = useRenameDevinSubscription(teamId);
  const updateDevinModels = useUpdateDevinSubscriptionModels(teamId);
  const updateAntigravityModels = useUpdateAntigravitySubscriptionModels(teamId);
  const updateClaudeModels = useUpdateClaudeSubscriptionModels(teamId);
  const renameAntigravitySubscription = useRenameAntigravitySubscription(teamId);
  const verification = useSubscriptionVerification(teamId);
  const devinVerification = useDevinSubscriptionVerification(teamId);
  const antigravityVerification = useAntigravitySubscriptionVerification(teamId);
  const [addView, setAddView] = useState<AddProviderView>('closed');
  const [removingSubscription, setRemovingSubscription] = useState<SubscriptionAccount | null>(
    null,
  );
  const [pickingSubscription, setPickingSubscription] = useState<SubscriptionAccount | null>(null);
  const upstreamCatalogRef = useRef<ReadonlyMap<string, SubscriptionModel>>(new Map());
  const [connectError, setConnectError] = useState<string | null>(null);
  const saveOrder = useSaveProviderOrder(teamId);
  const updateRuntime = useUpdateRuntime(teamId);
  const [updatingRuntimes, setUpdatingRuntimes] = useState<ReadonlySet<ManagedUpdateRuntime>>(
    () => new Set(),
  );
  const triggerRuntimeUpdate = (runtime: ManagedUpdateRuntime) => {
    if (!live) return;
    setUpdatingRuntimes((prev) => new Set(prev).add(runtime));
    updateRuntime.mutate(runtime, {
      onError: (error) => toastError(t('更新未能启动，请检查执行机连接后重试。'), error),
      onSettled: () =>
        setUpdatingRuntimes((prev) => {
          const next = new Set(prev);
          next.delete(runtime);
          return next;
        }),
    });
  };
  const [fixtureOrder, setFixtureOrder] = useState<string[] | null>(null);
  const [providerChecks, setProviderChecks] = useState<ProviderRowChecks>({});
  const refreshStates = useRef(new Map<string, ProviderRefreshState>());
  const refreshing = useRef(new Set<string>());

  const sources = live
    ? (sourcesQ.data?.sources ?? [])
    : (fixture.resources?.providerSources ?? []);
  const providers = live
    ? (providersQ.data?.providers ?? [])
    : (fixture.resources?.providers ?? []);
  const now = live ? Date.now() : fixture.now;
  const fixtureAccounts = fixture.resources?.accounts;
  const subscriptions: SubscriptionAccount[] = live
    ? (subscriptionsQ.data ?? []).map((wire) => toClaudeAccount(wire, now))
    : (fixtureAccounts?.subscriptions ?? []);
  const devinSubscriptions: SubscriptionAccount[] = live
    ? (devinSubscriptionsQ.data ?? []).map((wire) => toDevinAccount(wire, now))
    : (fixtureAccounts?.devinSubscriptions ?? []);
  const antigravitySubscriptions: SubscriptionAccount[] = live
    ? (antigravitySubscriptionsQ.data ?? []).map((wire) => toAntigravityAccount(wire, now))
    : (fixtureAccounts?.antigravitySubscriptions ?? []);
  const subscriptionApiIds = live ? (subscriptionsQ.data ?? []).map((s) => s.id) : [];
  const devinApiIds = live ? (devinSubscriptionsQ.data ?? []).map((s) => s.id) : [];
  const antigravityApiIds = live ? (antigravitySubscriptionsQ.data ?? []).map((s) => s.id) : [];

  useEffect(() => {
    if (live && teamId !== undefined) refreshQuota();
  }, [live, teamId, refreshQuota]);

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    if (oauth === 'error') {
      setConnectError(oauthReasonCopy(searchParams.get('reason'), t));
      setAddView('picker');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  useEffect(() => {
    const add = searchParams.get('add');
    if (add === null) return;
    setAddView(SUBSCRIPTION_VIEWS[add] ?? 'picker');
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const setParams = (patch: Record<string, string | null>, replace = false) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params, { replace });
  };

  const writeProviderCheck = (id: string, model: string, result: TeamProviderTestResult) => {
    setProviderChecks((checks) => recordProviderResult(checks, id, model, result));
  };

  const reconcileProviderList = async (id: string, fingerprint: string | undefined) => {
    if (teamId === undefined) return;
    const cache = client.getQueryCache();
    const query = cache.find<ProvidersEnvelope>({ queryKey: ['providers', teamId], exact: true });
    const states = refreshStates.current;
    const getState = () => states.get(teamId) ?? initialProviderRefresh;
    const active = refreshing.current;
    const state = issueCheckGeneration(
      getState(),
      id,
      fingerprint,
      query?.isActive() === true
        ? {
            fingerprint: query.state.data?.providers.find((provider) => provider.id === id)
              ?.configurationFingerprint,
            fetching: active.has(teamId) || query.state.fetchStatus !== 'idle',
          }
        : undefined,
    );
    states.set(teamId, state);
    if (query === undefined || active.has(teamId)) return;

    active.add(teamId);
    try {
      let after: number | null = null;
      while (query.isActive() && needsProviderList(getState(), after)) {
        const startedAfter = query.state.fetchStatus === 'idle' ? getState().generation : null;
        const unsubscribe =
          startedAfter === null
            ? undefined
            : cache.subscribe((event) => {
                if (
                  event.query === query &&
                  event.type === 'updated' &&
                  event.action.type === 'success' &&
                  !event.action.manual &&
                  query.state.data !== undefined
                ) {
                  states.set(
                    teamId,
                    applyListResponse(getState(), startedAfter, query.state.data.providers),
                  );
                }
              });
        await query
          .fetch(undefined, { cancelRefetch: false })
          .catch(() => undefined)
          .finally(unsubscribe);
        after = startedAfter;
      }
    } finally {
      active.delete(teamId);
    }
  };

  const actionsFor = (record: ProviderRecord): ProviderEditActions =>
    !live
      ? {
          patch: (body) => Promise.resolve({ ...record, ...body }),
          test: (model) => {
            if (record.configurationFingerprint === undefined)
              return Promise.resolve(SAMPLE_TEST_RESULT);
            const result = {
              ...SAMPLE_TEST_RESULT,
              configurationFingerprint: record.configurationFingerprint,
            };
            writeProviderCheck(record.id, model, result);
            return Promise.resolve(result);
          },
          listUpstream: () =>
            Promise.resolve({
              status: 'ok' as const,
              models: record.models.map((model) => ({ id: model.id, name: model.name })),
            }),
          remove: () => undefined,
        }
      : {
          patch: (body) =>
            mutations.patchProvider.mutateAsync({ id: record.id, body }).catch((error) => {
              toastError(t('保存失败，请重试。'), error);
              throw error;
            }),
          latest: () =>
            client
              .getQueryData<ProvidersEnvelope>(['providers', teamId])
              ?.providers.find((provider) => provider.id === record.id),
          ...(providersQ.data?.canTestConnection === true
            ? {
                test: async (model: string) => {
                  const result = await mutations.testProvider.mutateAsync({
                    id: record.id,
                    model,
                  });
                  writeProviderCheck(record.id, model, result);
                  void reconcileProviderList(record.id, result.configurationFingerprint);
                  return result;
                },
                listUpstream: () => mutations.upstreamModels.mutateAsync(record.id),
              }
            : {}),
          ...(record.providerId === 'gemini' && providersQ.data?.canTestConnection === true
            ? {
                onUpdateRuntime: () => triggerRuntimeUpdate('gemini'),
                updatingRuntime: updatingRuntimes.has('gemini'),
              }
            : {}),
          remove: () =>
            mutations.deleteProvider.mutate(record.id, {
              onError: (error) => toastError(t('移除失败，请重试。'), error),
            }),
        };

  const saveSubscriptionModels = (account: SubscriptionAccount, models: SubscriptionModel[]) => {
    const update =
      account.vendor === 'devin'
        ? updateDevinModels
        : account.vendor === 'antigravity'
          ? updateAntigravityModels
          : account.vendor === 'claude'
            ? updateClaudeModels
            : null;
    update?.mutate(
      { id: account.id, models },
      {
        onSuccess: () => setPickingSubscription(null),
        onError: (error) => toastError(t('保存失败，请重试。'), error),
      },
    );
  };

  const verifyByVendor: Partial<Record<AccountVendor, typeof verification.verify>> = {
    devin: devinVerification.verify,
    antigravity: antigravityVerification.verify,
  };
  const renameByVendor: Partial<
    Record<
      AccountVendor,
      {
        mutate: (
          input: { id: string; label: string },
          options: { onError: (error: Error) => void },
        ) => void;
      }
    >
  > = {
    devin: renameDevinSubscription,
    antigravity: renameAntigravitySubscription,
  };
  const apiIdsByVendor: Partial<Record<AccountVendor, readonly string[]>> = {
    devin: devinApiIds,
    antigravity: antigravityApiIds,
  };
  const deleteByVendor: Partial<Record<AccountVendor, typeof deleteSubscription>> = {
    devin: deleteDevinSubscription,
    antigravity: deleteAntigravitySubscription,
  };

  const startVerification = (ref: { id: string; vendor: AccountVendor }) => {
    void (verifyByVendor[ref.vendor] ?? verification.verify)(ref.id);
  };

  const claudeModels = subscriptionModels(sources, 'claude');

  const subscriptionActionsFor = (account: SubscriptionAccount): SubscriptionActions => {
    const rename = renameByVendor[account.vendor] ?? renameSubscription;
    const apiIds = apiIdsByVendor[account.vendor] ?? subscriptionApiIds;
    const managedRuntime: ManagedUpdateRuntime | null =
      account.vendor === 'claude' ? 'claude-code' : account.vendor === 'devin' ? 'devin' : null;
    return {
      onRemove: () => setRemovingSubscription(account),
      ...(managedRuntime !== null && (!live || providersQ.data?.canTestConnection === true)
        ? {
            onUpdateRuntime: () => triggerRuntimeUpdate(managedRuntime),
            updatingRuntime: updatingRuntimes.has(managedRuntime),
          }
        : {}),
      ...(live
        ? {
            onVerify: () => startVerification(account),
            ...(apiIds.includes(account.id)
              ? {
                  onRename: (label: string) =>
                    rename.mutate(
                      { id: account.id, label },
                      { onError: (error) => toastError(t('重命名失败，请重试。'), error) },
                    ),
                  ...(account.vendor === 'devin' ||
                  account.vendor === 'antigravity' ||
                  account.vendor === 'claude'
                    ? {
                        onPickUpstream: () => setPickingSubscription(account),
                        onRemoveModel: (id: string) =>
                          saveSubscriptionModels(
                            account,
                            ((account.models ?? []).length === 0
                              ? subscriptionModels(sources, account.vendor).map((model) => ({
                                  id: model.id,
                                  name: model.name,
                                }))
                              : (account.models ?? [])
                            ).filter((model) => model.id !== id),
                          ),
                        modelsBusy:
                          updateDevinModels.isPending ||
                          updateAntigravityModels.isPending ||
                          updateClaudeModels.isPending,
                      }
                    : {}),
                  ...(account.vendor === 'claude' && teamId !== undefined
                    ? {
                        onTestModel: (model: string) =>
                          testClaudeSubscriptionModel(teamId, account.id, model),
                      }
                    : {}),
                }
              : {}),
          }
        : {
            onVerify: () => undefined,
            onRename: () => undefined,
            ...(account.vendor === 'devin' ||
            account.vendor === 'antigravity' ||
            account.vendor === 'claude'
              ? { onPickUpstream: () => undefined, onRemoveModel: () => undefined }
              : {}),
            ...(account.vendor === 'claude'
              ? { onTestModel: () => Promise.resolve(SAMPLE_TEST_RESULT) }
              : {}),
          }),
    };
  };

  const subscriptionDeps = {
    now,
    verifications: {
      ...verification.states,
      ...devinVerification.states,
      ...antigravityVerification.states,
    },
    actionsFor: subscriptionActionsFor,
    t,
    clock,
  };
  const order = live ? (providersQ.data?.order ?? null) : fixtureOrder;
  const reorder = (ids: string[]) => {
    if (!live) {
      setFixtureOrder(ids);
      return;
    }
    saveOrder.mutate(ids, {
      onError: (error) => toastError(t('顺序未能保存，已恢复原来的顺序。'), error),
    });
  };
  const claudeUpdate = runtimeUpdateSummary(sources, 'claude-code');
  const devinUpdate = runtimeUpdateSummary(sources, 'devin');
  const geminiUpdate = runtimeUpdateSummary(sources, 'gemini');
  const defaultEntries = [
    ...subscriptionEntries(subscriptions, {
      ...subscriptionDeps,
      models: claudeModels,
      runtimeUpdate: claudeUpdate,
    }),
    ...subscriptionEntries(devinSubscriptions, {
      ...subscriptionDeps,
      models: subscriptionModels(sources, 'devin'),
      runtimeUpdate: devinUpdate,
    }),
    ...subscriptionEntries(antigravitySubscriptions, {
      ...subscriptionDeps,
      models: subscriptionModels(sources, 'antigravity'),
      reloginFor: (account) =>
        live && account.hasToken === false ? (
          <AntigravityRelogin onLoggedIn={() => startVerification(account)} />
        ) : undefined,
    }),
    ...teamEntries(
      providers,
      deadModelIds(sources),
      live ? (routingQ.data?.connections ?? []) : (fixtureAccounts?.routing.connections ?? []),
      providerChecks,
      geminiUpdate,
      actionsFor,
      t,
    ),
  ];
  const entries = orderByKeys(defaultEntries, (entry) => [entry.item.id], order);
  const partialFailure =
    subscriptionsQ.isError || devinSubscriptionsQ.isError || antigravitySubscriptionsQ.isError
      ? 'subscriptions'
      : providersQ.isError
        ? 'providers'
        : null;
  const itemParam = searchParams.get('item');
  const selected = entries.find((e) => e.item.id === itemParam) ?? entries[0];

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3">
        {live && partialFailure !== null && entries.length > 0 && (
          <p
            data-testid="providers-partial-error"
            role="alert"
            className="m-0 flex items-center gap-2 px-1 text-meta text-content-tertiary"
          >
            {partialFailure === 'subscriptions' ? t('订阅账户未能加载') : t('服务商未能加载')}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (partialFailure === 'subscriptions') {
                  void subscriptionsQ.refetch();
                  void devinSubscriptionsQ.refetch();
                  void antigravitySubscriptionsQ.refetch();
                } else {
                  void providersQ.refetch();
                }
              }}
            >
              {t('重试')}
            </Button>
          </p>
        )}
        <ProviderPanel
          items={entries.map((e) => e.item)}
          selectedId={selected?.item.id ?? null}
          onSelect={(id) => setParams({ item: id })}
          onReorder={reorder}
          empty={
            <QueryBoundary
              query={
                live
                  ? mergeQueries(
                      providersQ,
                      subscriptionsQ,
                      devinSubscriptionsQ,
                      antigravitySubscriptionsQ,
                    )
                  : undefined
              }
              isEmpty
              loadingLabel={t('正在加载服务商')}
              errorTitle={t('服务商未能加载')}
              empty={
                <EmptyState
                  testId="providers-empty"
                  icon={Cpu}
                  className="[&_p]:break-keep"
                  title={t('尚未添加服务商')}
                  description={t('添加 API key、订阅或自定义端点后，它们的模型会出现在这里。')}
                />
              }
            >
              {null}
            </QueryBoundary>
          }
        >
          {selected?.editor}
        </ProviderPanel>
      </div>
      <AddProviderFlow
        teamId={teamId}
        live={live}
        view={addView}
        onViewChange={setAddView}
        connectError={connectError}
        onConnectError={setConnectError}
        onSubscriptionCreated={(created, source) => {
          setParams({ item: `subscription:${created.id}` }, true);
          startVerification({ id: created.id, vendor: source });
        }}
      />
      {pickingSubscription !== null && live && teamId !== undefined && (
        <UpstreamModelPicker
          endpoint={`${pickingSubscription.vendor} · ${pickingSubscription.label}`}
          selected={(pickingSubscription.vendor === 'claude' &&
          (pickingSubscription.models ?? []).length === 0
            ? subscriptionModels(sources, 'claude')
            : (pickingSubscription.models ?? [])
          ).map((model) => model.id)}
          {...(pickingSubscription.vendor === 'claude'
            ? {}
            : {
                groupModels:
                  pickingSubscription.vendor === 'devin'
                    ? groupDevinUpstream
                    : groupAntigravityUpstream,
              })}
          testable={false}
          {...(pickingSubscription.vendor === 'antigravity'
            ? { fallbackReasons: ANTIGRAVITY_FALLBACK_REASONS }
            : {})}
          load={async () => {
            const result =
              pickingSubscription.vendor === 'devin'
                ? await fetchDevinUpstreamModels(teamId, pickingSubscription.id)
                : pickingSubscription.vendor === 'claude'
                  ? await fetchClaudeUpstreamModels(teamId, pickingSubscription.id)
                  : await fetchAntigravityUpstreamModels(teamId, pickingSubscription.id);
            if (result.status !== 'failed')
              upstreamCatalogRef.current = new Map(result.models.map((model) => [model.id, model]));
            return result;
          }}
          onClose={() => setPickingSubscription(null)}
          onSave={(ids) => {
            const catalog = upstreamCatalogRef.current;
            const models = ids.map((id) => catalog.get(id) ?? { id, name: id });
            saveSubscriptionModels(pickingSubscription, models);
          }}
        />
      )}
      <AlertDialogShell
        title={t('移除「{name}」？', { name: removingSubscription?.label ?? '' })}
        ariaLabel={t('移除订阅')}
        open={removingSubscription !== null}
        onClose={() => setRemovingSubscription(null)}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('移除')}
            confirmDisabled={
              deleteSubscription.isPending ||
              deleteDevinSubscription.isPending ||
              deleteAntigravitySubscription.isPending
            }
            onCancel={() => setRemovingSubscription(null)}
            onConfirm={() => {
              const target = removingSubscription;
              setRemovingSubscription(null);
              if (target === null || !live) return;
              const remove = deleteByVendor[target.vendor] ?? deleteSubscription;
              remove.mutate(target.id, {
                onSuccess: () =>
                  void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] }),
                onError: (error) => toastError(t('移除失败，请重试。'), error),
              });
            }}
          />
        }
      >
        <p className="m-0">{t('移除后，后续步骤不再使用这个订阅。')}</p>
      </AlertDialogShell>
    </>
  );
}
