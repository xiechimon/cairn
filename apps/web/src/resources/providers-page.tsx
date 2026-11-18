import type { ModelSource, ModelSourceModel, ProviderRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { accountStatusOf, type Verification } from '../api/account-verification.js';
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
  useClaudeSubscriptions,
  useDeleteClaudeSubscription,
  useRenameClaudeSubscription,
  useSubscriptionVerification,
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
import { useApiMutations, useModelSources, useProviders } from '../api/hooks.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useClock, VENDORS } from '../components/accounts/account-parts.js';
import { EmptyState } from '../components/empty-state.js';
import { type ProviderItem, ProviderPanel } from '../components/providers/provider-panel.js';
import { mergeQueries, QueryBoundary } from '../components/query-state.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { AddProviderFlow, type AddProviderView } from './add-provider-flow.js';
import {
  type ProviderEditActions,
  providerKind,
  providerMark,
  TeamProviderEditor,
} from './provider-editors.js';
import {
  type SubscriptionActions,
  SubscriptionDetail,
  subscriptionModels,
  subscriptionRowTone,
  subscriptionStatusView,
  subscriptionSummary,
} from './subscription-detail.js';
import { groupAntigravityUpstream, groupDevinUpstream } from './upstream-model-groups.js';
import { UpstreamModelPicker } from './upstream-model-picker.js';

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

function deadModelIds(sources: readonly ModelSource[]): Set<string> {
  return new Set(
    sources
      .filter((s) => s.runtime === 'pi')
      .flatMap((s) => s.models.filter((m) => m.liveness === 'dead').map((m) => m.id)),
  );
}

function teamEntries(
  providers: readonly ProviderRecord[],
  dead: ReadonlySet<string>,
  actionsFor: (record: ProviderRecord) => ProviderEditActions,
  t: TFunc,
): Entry[] {
  return providers.map((record) => {
    const retired = record.models.filter((m) => dead.has(m.id)).length;
    const parts = [t(providerKind(record)), t('{n} 个模型', { n: record.models.length })];
    if (retired > 0) parts.push(t('{n} 个已下架', { n: retired }));
    return {
      item: {
        id: `provider:${record.id}`,
        name: record.label,
        Mark: providerMark(record),
        status: parts.join(' · '),
        tone: record.models.length === 0 || retired > 0 ? 'warn' : 'ok',
      },
      editor: (
        <TeamProviderEditor
          key={record.id}
          record={record}
          deadModels={dead}
          actions={actionsFor(record)}
        />
      ),
    };
  });
}

interface SubscriptionEntryDeps {
  now: number;
  models: readonly ModelSourceModel[];
  verifications: Record<string, Verification>;
  actionsFor: (account: SubscriptionAccount) => SubscriptionActions;
  t: TFunc;
  clock: (ts: number, now: number) => string;
}

function subscriptionEntries(
  accounts: readonly SubscriptionAccount[],
  deps: SubscriptionEntryDeps,
): Entry[] {
  return accounts.map((account) => {
    const verification = deps.verifications[account.id];
    const view = subscriptionStatusView(
      account,
      accountStatusOf(account, verification),
      deps.now,
      deps.t,
      deps.clock,
    );
    const runtimeLiveness = new Map(deps.models.map((model) => [model.id, model.liveness]));
    const picked =
      account.vendor === 'devin' || account.vendor === 'antigravity'
        ? (account.models ?? [])
        : undefined;
    const pickedWithLiveness = picked?.map((model) => ({
      ...model,
      liveness: runtimeLiveness.get(model.id) === 'dead' ? 'dead' : model.liveness,
    }));
    const rowModels =
      picked !== undefined && picked.length > 0 ? (picked as ModelSourceModel[]) : deps.models;
    return {
      item: {
        id: `subscription:${account.id}`,
        name: account.label,
        Mark: VENDORS[account.vendor].Mark,
        status: subscriptionSummary(account, view, rowModels, deps.now, deps.t),
        tone: subscriptionRowTone(view, rowModels),
      },
      editor: (
        <SubscriptionDetail
          key={account.id}
          account={account}
          models={deps.models}
          picked={pickedWithLiveness}
          now={deps.now}
          view={view}
          verifying={verification?.phase === 'verifying'}
          actions={deps.actionsFor(account)}
        />
      ),
    };
  });
}

export function ProvidersSection() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const sourcesQ = useModelSources(teamId, live);
  const providersQ = useProviders(teamId, live);
  const mutations = useApiMutations(teamId);
  const client = useQueryClient();
  const clock = useClock();
  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const devinSubscriptionsQ = useDevinSubscriptions(teamId, live);
  const antigravitySubscriptionsQ = useAntigravitySubscriptions(teamId, live);
  const deleteSubscription = useDeleteClaudeSubscription(teamId);
  const deleteDevinSubscription = useDeleteDevinSubscription(teamId);
  const deleteAntigravitySubscription = useDeleteAntigravitySubscription(teamId);
  const renameSubscription = useRenameClaudeSubscription(teamId);
  const renameDevinSubscription = useRenameDevinSubscription(teamId);
  const updateDevinModels = useUpdateDevinSubscriptionModels(teamId);
  const updateAntigravityModels = useUpdateAntigravitySubscriptionModels(teamId);
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

  const actionsFor = (record: ProviderRecord): ProviderEditActions =>
    live
      ? {
          patch: (body) =>
            mutations.patchProvider.mutateAsync({ id: record.id, body }).catch((error) => {
              toastError(t('保存失败，请重试。'), error);
              throw error;
            }),
          ...(providersQ.data?.canTestConnection === true
            ? {
                test: (model: string) =>
                  mutations.testProvider.mutateAsync({ id: record.id, model }),
                listUpstream: () => mutations.upstreamModels.mutateAsync(record.id),
              }
            : {}),
          remove: () =>
            mutations.deleteProvider.mutate(record.id, {
              onError: (error) => toastError(t('移除失败，请重试。'), error),
            }),
        }
      : {};

  const saveSubscriptionModels = (account: SubscriptionAccount, models: SubscriptionModel[]) => {
    const update =
      account.vendor === 'devin'
        ? updateDevinModels
        : account.vendor === 'antigravity'
          ? updateAntigravityModels
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

  const announceVerification = (ref: { id: string; label: string; vendor: AccountVendor }) => {
    const verify = verifyByVendor[ref.vendor] ?? verification.verify;
    void verify(ref.id).then((outcome) => {
      if (outcome?.ok) toastSuccess(t('「{name}」验证通过', { name: ref.label }));
    });
  };

  const subscriptionActionsFor = (account: SubscriptionAccount): SubscriptionActions => {
    const rename = renameByVendor[account.vendor] ?? renameSubscription;
    const apiIds = apiIdsByVendor[account.vendor] ?? subscriptionApiIds;
    return {
      onRemove: () => setRemovingSubscription(account),
      ...(live
        ? {
            onVerify: () => announceVerification(account),
            ...(apiIds.includes(account.id)
              ? {
                  onRename: (label: string) =>
                    rename.mutate(
                      { id: account.id, label },
                      { onError: (error) => toastError(t('重命名失败，请重试。'), error) },
                    ),
                  ...(account.vendor === 'devin' || account.vendor === 'antigravity'
                    ? {
                        onPickUpstream: () => setPickingSubscription(account),
                        onRemoveModel: (id: string) =>
                          saveSubscriptionModels(
                            account,
                            (account.models ?? []).filter((model) => model.id !== id),
                          ),
                        modelsBusy:
                          account.vendor === 'devin'
                            ? updateDevinModels.isPending
                            : updateAntigravityModels.isPending,
                      }
                    : {}),
                }
              : {}),
          }
        : {}),
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
  const entries = [
    ...subscriptionEntries(subscriptions, {
      ...subscriptionDeps,
      models: subscriptionModels(sources, 'claude'),
    }),
    ...subscriptionEntries(devinSubscriptions, {
      ...subscriptionDeps,
      models: subscriptionModels(sources, 'devin'),
    }),
    ...subscriptionEntries(antigravitySubscriptions, {
      ...subscriptionDeps,
      models: subscriptionModels(sources, 'antigravity'),
    }),
    ...teamEntries(providers, deadModelIds(sources), actionsFor, t),
  ];
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
            {partialFailure === 'subscriptions' ? t('订阅账户没能加载') : t('模型服务没能加载')}
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
              loadingLabel={t('正在加载模型服务')}
              errorTitle={t('模型服务没能加载')}
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
          announceVerification({ id: created.id, label: created.label, vendor: source });
        }}
      />
      {pickingSubscription !== null && live && teamId !== undefined && (
        <UpstreamModelPicker
          endpoint={`${pickingSubscription.vendor} · ${pickingSubscription.label}`}
          selected={(pickingSubscription.models ?? []).map((model) => model.id)}
          groupModels={
            pickingSubscription.vendor === 'devin' ? groupDevinUpstream : groupAntigravityUpstream
          }
          testable={false}
          load={async () => {
            const result =
              pickingSubscription.vendor === 'devin'
                ? await fetchDevinUpstreamModels(teamId, pickingSubscription.id)
                : await fetchAntigravityUpstreamModels(teamId, pickingSubscription.id);
            if (result.status === 'ok')
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
