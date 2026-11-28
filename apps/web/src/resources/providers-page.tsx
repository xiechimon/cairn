import {
  antigravitySubscriptionModelSchema,
  claudeSubscriptionModelSchema,
  devinSubscriptionModelSchema,
  doubaoSubscriptionModelSchema,
  type ManagedUpdateRuntime,
  type ModelSource,
  type ModelSourceModel,
  orderByKeys,
  PROVIDER_CODEX_PRESET,
  PROVIDER_OAUTH_PRESET_IDS,
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
  useRefreshAntigravityQuota,
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
  fetchDoubaoUpstreamModels,
  toDoubaoAccount,
  useDeleteDoubaoSubscription,
  useDisableDoubaoSubscription,
  useDoubaoSubscriptions,
  useDoubaoSubscriptionVerification,
  useEnableDoubaoSubscription,
  useRenameDoubaoSubscription,
  useUpdateDoubaoSubscriptionModels,
} from '../api/doubao-subscriptions.js';
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
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { isDesktopShell } from '../desktop-shell.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import {
  AddProviderFlow,
  type AddProviderView,
  type SubscriptionRelogin,
} from './add-provider-flow.js';
import { AntigravityRelogin, antigravityBridge } from './antigravity-subscriptions.js';
import { DoubaoRunnerLoginsSection } from './doubao-qr-login.js';
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
  needsSubscriptionSignIn,
  providerRowStatus,
  type RuntimeUpdateSummary,
  runtimeUpdateSummary,
  type SubscriptionActions,
  SubscriptionDetail,
  subscriptionModels,
  subscriptionStatusView,
  subscriptionSummary,
  teamProviderStatusView,
} from './subscription-detail.js';
import { currentQuotaWindows, QuotaMark } from './subscription-quota.js';
import {
  groupAntigravityUpstream,
  groupDevinUpstream,
  groupDoubaoUpstream,
} from './upstream-model-groups.js';
import { UpstreamModelPicker } from './upstream-model-picker.js';

const ANTIGRAVITY_FALLBACK_REASONS = {
  auth: '该订阅未启用或登录凭据不可用。请启用订阅，或重新添加账号并登录。',
  'not-found': '没有获准查询该订阅的在线执行机。请检查执行机连接与模型设置。',
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

function displayedSubscriptionModels(
  account: SubscriptionAccount,
  runtimeModels: readonly ModelSourceModel[],
): SubscriptionModel[] {
  if (account.vendor === 'doubao') {
    const liveModels = account.runnerModels ?? runtimeModels;
    const allowed = new Set(liveModels.map((model) => model.id));
    if (account.models?.length) {
      return allowed.size > 0 ? account.models.filter((model) => allowed.has(model.id)) : [];
    }
    return liveModels.map(({ id, name }) => ({ id, name }));
  }
  if (account.models?.length) return account.models;
  if (account.vendor === 'antigravity') {
    return account.hasToken === false ? (account.runnerModels ?? []) : [];
  }
  return runtimeModels.map(({ id, name }) => ({ id, name }));
}

function subscriptionEntries(
  accounts: readonly SubscriptionAccount[],
  deps: SubscriptionEntryDeps,
): Entry[] {
  return accounts.map((account) => {
    const verification = deps.verifications[account.id];
    const relogin = deps.reloginFor?.(account);
    const view = subscriptionStatusView(account, deps.now, deps.t, deps.clock);
    const runtimeLiveness = new Map(deps.models.map((model) => [model.id, model.liveness]));
    const runtimeUpdate = new Map(deps.models.map((model) => [model.id, model.updateRequired]));
    const shown = displayedSubscriptionModels(account, deps.models).map((model) => ({
      ...model,
      liveness: runtimeLiveness.get(model.id) === 'dead' ? ('dead' as const) : model.liveness,
      updateRequired:
        runtimeUpdate.get(model.id) ??
        ('updateRequired' in model
          ? (model as Pick<ModelSourceModel, 'updateRequired'>).updateRequired
          : undefined),
    }));
    const status = providerRowStatus(view, shown, deps.t);
    return {
      item: {
        id: `subscription:${account.id}`,
        name: account.label,
        Mark: VENDORS[account.vendor].Mark,
        status: subscriptionSummary(shown.length, deps.t),
        ...status,
        aside: <QuotaMark windows={currentQuotaWindows(account.windows, deps.now)} />,
      },
      editor: (
        <SubscriptionDetail
          key={account.id}
          account={account}
          models={shown}
          now={deps.now}
          view={relogin && account.state === 'expired' ? { ...view, reason: null } : view}
          verification={verification}
          runtimeUpdate={deps.runtimeUpdate ?? null}
          actions={deps.actionsFor(account)}
          relogin={relogin}
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
  const doubaoSubscriptionsQ = useDoubaoSubscriptions(teamId, live);
  const refreshAntigravityQuota = useRefreshAntigravityQuota(teamId).mutate;
  const deleteSubscription = useDeleteClaudeSubscription(teamId);
  const deleteDevinSubscription = useDeleteDevinSubscription(teamId);
  const deleteAntigravitySubscription = useDeleteAntigravitySubscription(teamId);
  const deleteDoubaoSubscription = useDeleteDoubaoSubscription(teamId);
  const enableDoubaoSubscription = useEnableDoubaoSubscription(teamId);
  const disableDoubaoSubscription = useDisableDoubaoSubscription(teamId);
  const renameSubscription = useRenameClaudeSubscription(teamId);
  const renameDevinSubscription = useRenameDevinSubscription(teamId);
  const updateDevinModels = useUpdateDevinSubscriptionModels(teamId);
  const updateAntigravityModels = useUpdateAntigravitySubscriptionModels(teamId);
  const updateDoubaoModels = useUpdateDoubaoSubscriptionModels(teamId);
  const updateClaudeModels = useUpdateClaudeSubscriptionModels(teamId);
  const renameAntigravitySubscription = useRenameAntigravitySubscription(teamId);
  const renameDoubaoSubscription = useRenameDoubaoSubscription(teamId);
  const verification = useSubscriptionVerification(teamId);
  const devinVerification = useDevinSubscriptionVerification(teamId);
  const antigravityVerification = useAntigravitySubscriptionVerification(teamId);
  const doubaoVerification = useDoubaoSubscriptionVerification(teamId);
  const [verifyAfterCreate, setVerifyAfterCreate] = useState<{
    id: string;
    vendor: AccountVendor;
    force?: boolean;
  } | null>(null);
  const [addView, setAddView] = useState<AddProviderView>('closed');
  const [reloginTarget, setReloginTarget] = useState<SubscriptionRelogin | null>(null);
  const [removingSubscription, setRemovingSubscription] = useState<SubscriptionAccount | null>(
    null,
  );
  const [subscriptionPicker, setSubscriptionPicker] = useState<{
    account: SubscriptionAccount;
    opener: HTMLButtonElement;
  } | null>(null);
  const { account: pickingSubscription = null, opener: subscriptionPickerOpener } =
    subscriptionPicker ?? {};
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
  const doubaoSubscriptions: SubscriptionAccount[] = live
    ? (doubaoSubscriptionsQ.data?.subscriptions ?? []).map((wire) => toDoubaoAccount(wire))
    : (fixtureAccounts?.doubaoSubscriptions ?? []);
  const subscriptionApiIds = live ? (subscriptionsQ.data ?? []).map((s) => s.id) : [];
  const devinApiIds = live ? (devinSubscriptionsQ.data ?? []).map((s) => s.id) : [];
  const antigravityApiIds = live ? (antigravitySubscriptionsQ.data ?? []).map((s) => s.id) : [];
  const doubaoApiIds = live
    ? (doubaoSubscriptionsQ.data?.subscriptions ?? []).map((s) => s.id)
    : [];
  const antigravityOAuthIds = new Set(
    antigravitySubscriptionsQ.data
      ?.filter((row) => row.oauthPersonal === true)
      .map((row) => row.id),
  );

  useEffect(() => {
    if (live && teamId !== undefined) {
      refreshQuota();
      refreshAntigravityQuota();
    }
  }, [live, teamId, refreshQuota, refreshAntigravityQuota]);

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    const presetId = searchParams.get('provider');
    if (oauth === 'connected' && live && providersQ.isPending) return;
    if (oauth === 'error') {
      setConnectError(oauthReasonCopy(searchParams.get('reason'), t));
      setAddView('picker');
    } else if (
      oauth === 'connected' &&
      live &&
      providersQ.data?.providers.some((record) => record.providerId === presetId) === true
    ) {
      toastSuccess(t('已连接服务商'));
    }
    const next = new URLSearchParams(searchParams);
    if (oauth === 'connected') next.delete('provider');
    next.delete('oauth');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [live, providersQ.data, providersQ.isPending, searchParams, setSearchParams, t]);

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

  const connections = live
    ? (routingQ.data?.connections ?? [])
    : (fixtureAccounts?.routing.connections ?? []);

  const actionsFor = (record: ProviderRecord): ProviderEditActions => {
    const statusView = teamProviderStatusView(record, connections, providerChecks[record.id], t);
    const isOAuth = (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(record.providerId);
    const needsOAuthSignIn = isOAuth && (statusView.tone === 'fail' || statusView.tone === 'warn');
    if (!live) {
      return {
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
        ...(needsOAuthSignIn ? { onSignInAgain: () => setAddView('picker') } : {}),
        remove: () => undefined,
      };
    }
    return {
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
      ...(needsOAuthSignIn
        ? {
            onSignInAgain: () => {
              if (record.providerId === PROVIDER_CODEX_PRESET.id) {
                setAddView('codex-sign-in');
                return;
              }
              setConnectError(null);
              mutations.startProviderOAuth.mutate(record.providerId, {
                onSuccess: (data) => window.location.assign(data.authorizationUrl),
                onError: (err) => toastError(t('无法发起登录，请重试。'), err),
              });
            },
            signingInAgain:
              record.providerId !== PROVIDER_CODEX_PRESET.id &&
              mutations.startProviderOAuth.isPending,
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
          onSuccess: () => toastSuccess(t('已移除服务商')),
          onError: (error) => toastError(t('移除失败，请重试。'), error),
        }),
    };
  };

  const saveSubscriptionModels = (account: SubscriptionAccount, models: SubscriptionModel[]) => {
    const update =
      account.vendor === 'devin'
        ? updateDevinModels
        : account.vendor === 'antigravity'
          ? updateAntigravityModels
          : account.vendor === 'doubao'
            ? updateDoubaoModels
            : account.vendor === 'claude'
              ? updateClaudeModels
              : null;
    update?.mutate(
      { id: account.id, models },
      {
        onSuccess: () => setSubscriptionPicker(null),
        onError: (error) => toastError(t('保存失败，请重试。'), error),
      },
    );
  };

  const verifyByVendor: Partial<Record<AccountVendor, typeof verification.verify>> = {
    devin: devinVerification.verify,
    antigravity: antigravityVerification.verify,
    doubao: doubaoVerification.verify,
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
    doubao: renameDoubaoSubscription,
  };
  const apiIdsByVendor: Partial<Record<AccountVendor, readonly string[]>> = {
    devin: devinApiIds,
    antigravity: antigravityApiIds,
    doubao: doubaoApiIds,
  };
  const deleteByVendor: Partial<Record<AccountVendor, typeof deleteSubscription>> = {
    devin: deleteDevinSubscription,
    antigravity: deleteAntigravitySubscription,
    doubao: deleteDoubaoSubscription,
  };

  const startVerification = (
    ref: { id: string; vendor: AccountVendor; runnerName?: string | null },
    opts: { retryOnMissingLogin?: boolean; force?: boolean } = {},
  ) => {
    if (ref.vendor === 'antigravity' || ref.vendor === 'doubao') {
      const verifyHost =
        ref.vendor === 'doubao' ? doubaoVerification.verify : antigravityVerification.verify;
      void verifyHost(ref.id, {
        ...(ref.runnerName === undefined ? {} : { runnerName: ref.runnerName }),
        ...(opts.retryOnMissingLogin === true ? { retryOnMissingLogin: true } : {}),
        ...(opts.force === true ? { force: true } : {}),
      });
      return;
    }
    void (verifyByVendor[ref.vendor] ?? verification.verify)(ref.id);
  };

  const claudeModels = subscriptionModels(sources, 'claude');

  const verifications: Record<string, Verification> = {
    ...verification.states,
    ...devinVerification.states,
    ...antigravityVerification.states,
    ...doubaoVerification.states,
  };

  const antigravityReloginFor = (account: SubscriptionAccount) => {
    if (!live || teamId === undefined || antigravityBridge() === null) return undefined;
    if (account.state === 'expired' || account.hasToken !== false) return undefined;
    return (
      <AntigravityRelogin
        teamId={teamId}
        subscription={account}
        renewOAuth={false}
        runnerId={account.runnerId}
        runnerLogin={account.runnerLogin}
        runnerLogins={account.runnerLogins}
        onLoggedIn={(bindRunnerId) => {
          const targetId = account.runnerId == null ? bindRunnerId : undefined;
          const targetName =
            targetId !== undefined
              ? (account.runnerLogins?.find((entry) => entry.runnerId === targetId)?.name ??
                account.runnerName)
              : undefined;
          void client.invalidateQueries({ queryKey: ['antigravity-subscriptions', teamId] });
          void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
          void antigravityVerification.verify(account.id, {
            ...(targetId === undefined ? {} : { runnerId: targetId }),
            ...(targetName === undefined ? {} : { runnerName: targetName }),
            retryOnMissingLogin: true,
            force: true,
          });
        }}
      />
    );
  };

  const openSubscriptionRelogin = (account: SubscriptionAccount) => {
    if (account.vendor === 'antigravity') {
      setReloginTarget({
        source: 'antigravity',
        id: account.id,
        label: account.label,
        attachInPlace: account.hasToken === false || antigravityOAuthIds.has(account.id),
      });
      setAddView('antigravity-subscription');
      return;
    }
    if (account.vendor === 'devin') {
      setReloginTarget({ source: 'devin', id: account.id, label: account.label });
      setAddView('devin-subscription');
      return;
    }
    if (account.vendor === 'claude') {
      setReloginTarget({ source: 'claude', id: account.id, label: account.label });
      setAddView('subscription');
    }
  };

  const subscriptionActionsFor = (account: SubscriptionAccount): SubscriptionActions => {
    const rename = renameByVendor[account.vendor] ?? renameSubscription;
    const apiIds = apiIdsByVendor[account.vendor] ?? subscriptionApiIds;
    const managedRuntime: ManagedUpdateRuntime | null =
      account.vendor === 'claude' ? 'claude-code' : account.vendor === 'devin' ? 'devin' : null;
    const inlineRelogin =
      account.vendor === 'antigravity' && antigravityReloginFor(account) !== undefined;
    const canSignInAgain =
      !inlineRelogin &&
      needsSubscriptionSignIn(account, verifications[account.id]) &&
      ((account.vendor === 'antigravity' &&
        (!live || typeof window === 'undefined' || isDesktopShell())) ||
        account.vendor === 'claude' ||
        account.vendor === 'devin');
    return {
      onRemove: () => setRemovingSubscription(account),
      ...(canSignInAgain ? { onSignInAgain: () => openSubscriptionRelogin(account) } : {}),
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
                  ...(account.vendor === 'doubao' && providersQ.data?.canTestConnection === true
                    ? {
                        onToggleEnabled: () =>
                          (account.enabled === false
                            ? enableDoubaoSubscription
                            : disableDoubaoSubscription
                          ).mutate(account.id, {
                            onSuccess: () =>
                              void client.invalidateQueries({
                                queryKey: [MODEL_ROUTING_KEY, teamId],
                              }),
                            onError: (error) => toastError(t('保存失败，请重试。'), error),
                          }),
                        toggleBusy:
                          enableDoubaoSubscription.isPending || disableDoubaoSubscription.isPending,
                      }
                    : {}),
                  ...(account.vendor === 'devin' ||
                  account.vendor === 'antigravity' ||
                  account.vendor === 'doubao' ||
                  account.vendor === 'claude'
                    ? {
                        onPickUpstream: (opener: HTMLButtonElement) =>
                          setSubscriptionPicker({ account, opener }),
                        onRemoveModel: (id: string) =>
                          saveSubscriptionModels(
                            account,
                            displayedSubscriptionModels(
                              account,
                              subscriptionModels(sources, account.vendor),
                            ).filter((model) => model.id !== id),
                          ),
                        modelsBusy:
                          updateDevinModels.isPending ||
                          updateAntigravityModels.isPending ||
                          updateDoubaoModels.isPending ||
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
            ...(account.vendor === 'doubao' ? { onToggleEnabled: () => undefined } : {}),
            ...(account.vendor === 'devin' ||
            account.vendor === 'antigravity' ||
            account.vendor === 'doubao' ||
            account.vendor === 'claude'
              ? { onPickUpstream: () => undefined, onRemoveModel: () => undefined }
              : {}),
            ...(account.vendor === 'claude'
              ? { onTestModel: () => Promise.resolve(SAMPLE_TEST_RESULT) }
              : {}),
          }),
    };
  };

  const doubaoReloginFor = (account: SubscriptionAccount) =>
    account.vendor === 'doubao' ? (
      <DoubaoRunnerLoginsSection
        account={account}
        teamId={teamId}
        canManage={!live || providersQ.data?.canTestConnection === true}
      />
    ) : undefined;

  const subscriptionDeps = {
    now,
    verifications,
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
      reloginFor: antigravityReloginFor,
    }),
    ...subscriptionEntries(doubaoSubscriptions, {
      ...subscriptionDeps,
      models: subscriptionModels(sources, 'doubao'),
      reloginFor: doubaoReloginFor,
    }),
    ...teamEntries(
      providers,
      deadModelIds(sources),
      connections,
      providerChecks,
      geminiUpdate,
      actionsFor,
      t,
    ),
  ];
  const entries = orderByKeys(defaultEntries, (entry) => [entry.item.id], order);
  const partialFailure =
    subscriptionsQ.isError ||
    devinSubscriptionsQ.isError ||
    antigravitySubscriptionsQ.isError ||
    doubaoSubscriptionsQ.isError
      ? 'subscriptions'
      : providersQ.isError
        ? 'providers'
        : null;
  const itemParam = searchParams.get('item');
  const selected = entries.find((e) => e.item.id === itemParam) ?? entries[0];
  const selectedId = selected?.item.id;
  useEffect(() => {
    if (verifyAfterCreate === null) return;
    const target = `subscription:${verifyAfterCreate.id}`;
    if (itemParam !== target || selectedId !== target) return;
    setVerifyAfterCreate(null);
    startVerification(verifyAfterCreate, {
      retryOnMissingLogin: true,
      ...(verifyAfterCreate.force === true ? { force: true } : {}),
    });
  }, [itemParam, selectedId, startVerification, verifyAfterCreate]);

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
                  void doubaoSubscriptionsQ.refetch();
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
          onSelect={(id) => {
            setVerifyAfterCreate(null);
            setParams({ item: id });
          }}
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
                      doubaoSubscriptionsQ,
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
        onViewChange={(next) => {
          setAddView(next);
          if (next === 'closed') setReloginTarget(null);
        }}
        relogin={reloginTarget}
        connectError={connectError}
        onConnectError={setConnectError}
        onSubscriptionCreated={(created, source) => {
          setReloginTarget(null);
          setParams({ item: `subscription:${created.id}` }, true);
          setVerifyAfterCreate({ id: created.id, vendor: source, force: true });
        }}
      />
      {pickingSubscription !== null && live && teamId !== undefined && (
        <UpstreamModelPicker<SubscriptionModel>
          key={JSON.stringify([teamId, pickingSubscription.vendor, pickingSubscription.id])}
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
                    : pickingSubscription.vendor === 'doubao'
                      ? groupDoubaoUpstream
                      : groupAntigravityUpstream,
              })}
          modelIdSchema={
            pickingSubscription.vendor === 'claude'
              ? claudeSubscriptionModelSchema.shape.id
              : pickingSubscription.vendor === 'devin'
                ? devinSubscriptionModelSchema.shape.id
                : pickingSubscription.vendor === 'doubao'
                  ? doubaoSubscriptionModelSchema.shape.id
                  : antigravitySubscriptionModelSchema.shape.id
          }
          testable={false}
          subscription
          {...(pickingSubscription.vendor === 'antigravity'
            ? {
                fallbackReasons: antigravityOAuthIds.has(pickingSubscription.id)
                  ? {
                      ...ANTIGRAVITY_FALLBACK_REASONS,
                      auth: '上游拒绝了这个订阅的登录，未能获取模型清单。请重新登录后重试。',
                    }
                  : ANTIGRAVITY_FALLBACK_REASONS,
              }
            : {})}
          load={() =>
            pickingSubscription.vendor === 'devin'
              ? fetchDevinUpstreamModels(teamId, pickingSubscription.id)
              : pickingSubscription.vendor === 'claude'
                ? fetchClaudeUpstreamModels(teamId, pickingSubscription.id)
                : pickingSubscription.vendor === 'doubao'
                  ? fetchDoubaoUpstreamModels(teamId, pickingSubscription.id)
                  : fetchAntigravityUpstreamModels(teamId, pickingSubscription.id)
          }
          opener={subscriptionPickerOpener}
          onClose={() => setSubscriptionPicker(null)}
          onSave={(ids, catalog) => {
            const saved = new Map(pickingSubscription.models?.map((model) => [model.id, model]));
            const models = ids.map((id) => catalog.get(id) ?? saved.get(id) ?? { id, name: id });
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
              deleteAntigravitySubscription.isPending ||
              deleteDoubaoSubscription.isPending
            }
            onCancel={() => setRemovingSubscription(null)}
            onConfirm={() => {
              const target = removingSubscription;
              setRemovingSubscription(null);
              if (target === null || !live) return;
              const remove = deleteByVendor[target.vendor] ?? deleteSubscription;
              remove.mutate(target.id, {
                onSuccess: () => {
                  void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
                  toastSuccess(t('已移除服务商'));
                },
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
