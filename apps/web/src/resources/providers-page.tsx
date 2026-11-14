import type { MachineRuntime, ModelSource, ProviderRecord } from '@cairn/shared';
import { MACHINE_RUNTIMES } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, Plus } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { accountStatusOf, type Verification } from '../api/account-verification.js';
import {
  type AccountStep,
  type StickyThread,
  type SubscriptionAccount,
  toClaudeAccount,
} from '../api/claude-accounts.js';
import {
  useClaudeSubscriptionSteps,
  useClaudeSubscriptionStickiness,
  useClaudeSubscriptions,
  useCreateClaudeSubscription,
  useDeleteClaudeSubscription,
  useRenameClaudeSubscription,
  useSubscriptionVerification,
} from '../api/claude-subscriptions.js';
import { useApiMutations, useMachines, useModelSources, useProviders } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import { MODEL_ROUTING_KEY } from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useClock } from '../components/accounts/account-parts.js';
import { ClaudeMark, GeminiMark, PiMark } from '../components/brand-marks.js';
import { CheckedButton } from '../components/checked-button.js';
import { EmptyState } from '../components/empty-state.js';
import { type ProviderItem, ProviderPanel } from '../components/providers/provider-panel.js';
import { mergeQueries, QueryBoundary } from '../components/query-state.js';
import { SettingsScopeSentence, useSettingsScope } from '../components/settings-scope.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { oauthReasonCopy } from '../i18n/oauth-reason.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { PageShell } from '../pages/shell.js';
import { AddClaudeSubscriptionDialog } from './claude-subscriptions.js';
import { PROVIDERS_HREF } from './hrefs.js';
import {
  ClaudeCodeEditor,
  claudeCodeStatus,
  GeminiEditor,
  PiEditor,
  type ProviderEditActions,
  providerKind,
  providerMark,
  TeamProviderEditor,
} from './provider-editors.js';
import {
  type SubscriptionActions,
  SubscriptionDetail,
  subscriptionStatusView,
  subscriptionSummary,
} from './subscription-detail.js';

interface Entry {
  item: ProviderItem;
  editor: ReactNode;
}

const CLAUDE_SUBSCRIPTION_ADD = 'claude-subscription';
const CreateProviderDialog = lazy(async () => ({
  default: (await import('./create-provider-dialog.js')).CreateProviderDialog,
}));

const isMachineRuntime = (value: string): value is MachineRuntime =>
  (MACHINE_RUNTIMES as readonly string[]).includes(value);

function sourceFor(machine: MachineRow, sources: readonly ModelSource[]): ModelSource | undefined {
  const claude = sources.filter((s) => s.runtime === 'claude-code');
  return (
    claude.find((s) => s.machineId !== undefined && s.machineId === machine.id) ??
    claude.find((s) => s.machineId === undefined && s.hostname === machine.name)
  );
}

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
        tone: retired > 0 ? 'warn' : 'ok',
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
  steps: Record<string, AccountStep[]>;
  sticky: StickyThread[];
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
    return {
      item: {
        id: `subscription:${account.id}`,
        name: account.label,
        Mark: ClaudeMark,
        status: subscriptionSummary(account, view, deps.now, deps.t),
        tone: view.tone,
      },
      editor: (
        <SubscriptionDetail
          key={account.id}
          account={account}
          now={deps.now}
          view={view}
          verifying={verification?.phase === 'verifying'}
          steps={deps.steps[account.id]}
          sticky={deps.sticky.filter((thread) => thread.subscriptionId === account.id)}
          actions={deps.actionsFor(account)}
        />
      ),
    };
  });
}

function machineEntries(
  machine: MachineRow,
  source: ModelSource | undefined,
  providerCount: number,
  toggle: ((runtime: MachineRuntime, next: boolean) => void) | undefined,
  onShowTeam: () => void,
  t: TFunc,
): Entry[] {
  const enabled = new Set(machine.enabledRuntimes ?? []);
  const online = machine.online !== false;
  const switchFor = (runtime: MachineRuntime) => ({
    checked: enabled.has(runtime),
    disabled: toggle === undefined || !online,
    onChange: (next: boolean) => toggle?.(runtime, next),
  });
  const claude = claudeCodeStatus(source, online);
  const bin = typeof source?.bin === 'object' && source.bin !== null ? source.bin : null;
  const offTone = (runtime: MachineRuntime, tone: ProviderItem['tone']) =>
    enabled.has(runtime) ? tone : 'off';
  return [
    {
      item: {
        id: 'claude-code',
        name: 'Claude Code',
        Mark: ClaudeMark,
        version: bin?.version ?? null,
        status: t(claude.status),
        tone: claude.tone === 'warn' ? 'warn' : offTone('claude-code', claude.tone),
        toggle: switchFor('claude-code'),
      },
      editor: (
        <ClaudeCodeEditor source={source} machineName={machine.name} status={claude.status} />
      ),
    },
    {
      item: {
        id: 'pi',
        name: 'pi',
        Mark: PiMark,
        status: online ? t('使用所有机器的服务商') : t('离线'),
        tone: online ? offTone('pi', 'ok') : 'warn',
        toggle: switchFor('pi'),
      },
      editor: (
        <PiEditor
          machineName={machine.name}
          providerCount={providerCount}
          onShowTeam={onShowTeam}
        />
      ),
    },
    {
      item: {
        id: 'gemini',
        name: 'Gemini CLI',
        Mark: GeminiMark,
        status: enabled.has('gemini') ? t('还没上报') : t('接入命令闸前不能开启'),
        tone: 'off',
        toggle: enabled.has('gemini')
          ? switchFor('gemini')
          : { ...switchFor('gemini'), disabled: true },
      },
      editor: <GeminiEditor machineName={machine.name} />,
    },
  ];
}

export function ProvidersPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const sourcesQ = useModelSources(teamId, live);
  const providersQ = useProviders(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mutations = useApiMutations(teamId);
  const client = useQueryClient();
  const clock = useClock();
  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const createSubscription = useCreateClaudeSubscription(teamId);
  const deleteSubscription = useDeleteClaudeSubscription(teamId);
  const renameSubscription = useRenameClaudeSubscription(teamId);
  const verification = useSubscriptionVerification(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDialogWanted, setCreateDialogWanted] = useState(false);
  if (createOpen && !createDialogWanted) setCreateDialogWanted(true);
  const [addingSubscription, setAddingSubscription] = useState(false);
  const [removingSubscription, setRemovingSubscription] = useState<SubscriptionAccount | null>(
    null,
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const [xaiDevice, setXaiDevice] = useState<{
    state: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
  } | null>(null);
  const [xaiDeviceError, setXaiDeviceError] = useState<string | null>(null);
  const pollXai = useRef(mutations.pollXaiDevice);
  pollXai.current = mutations.pollXaiDevice;

  const sources = live
    ? (sourcesQ.data?.sources ?? [])
    : (fixture.resources?.providerSources ?? []);
  const providers = live
    ? (providersQ.data?.providers ?? [])
    : (fixture.resources?.providers ?? []);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const now = live ? Date.now() : fixture.now;
  const fixtureAccounts = fixture.resources?.accounts;
  const subscriptions: SubscriptionAccount[] = (
    live ? (subscriptionsQ.data ?? []) : (fixtureAccounts?.subscriptions ?? [])
  ).map((wire) => toClaudeAccount(wire, now));
  const subscriptionApiIds = live
    ? (subscriptionsQ.data ?? []).filter((s) => s.state !== undefined).map((s) => s.id)
    : [];
  const stepsQ = useClaudeSubscriptionSteps(teamId, subscriptionApiIds, live);
  const stickinessQ = useClaudeSubscriptionStickiness(
    teamId,
    live && subscriptionApiIds.length > 0,
  );
  const stepsByAccount: Record<string, AccountStep[]> = live
    ? Object.fromEntries(
        subscriptionApiIds.flatMap((id, index) => {
          const page = stepsQ[index]?.data;
          return page == null || !Array.isArray(page.steps) ? [] : [[id, page.steps]];
        }),
      )
    : (fixtureAccounts?.stepsByAccount ?? {});
  const stickiness: StickyThread[] = live
    ? (stickinessQ.data?.threads ?? [])
    : (fixtureAccounts?.stickiness ?? []);

  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === null) return;
    if (oauth === 'error') {
      setConnectError(oauthReasonCopy(searchParams.get('reason'), t));
      setCreateOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('oauth');
    next.delete('reason');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  useEffect(() => {
    if (!createOpen || xaiDevice === null) return;
    let stopped = false;
    const timer = setInterval(() => {
      void pollXai.current.mutateAsync(xaiDevice.state).then(
        (result) => {
          if (stopped) return;
          if (result.status === 'complete') {
            setXaiDevice(null);
            setXaiDeviceError(null);
            setCreateOpen(false);
            return;
          }
          if (result.status === 'denied') {
            setXaiDevice(null);
            setXaiDeviceError(t('xAI 登录被拒绝。'));
          } else if (result.status === 'superseded') {
            setXaiDevice(null);
            setXaiDeviceError(t('已有更新的 xAI 凭证，这次登录没有覆盖它。'));
          } else if (result.status === 'expired') {
            setXaiDevice(null);
            setXaiDeviceError(t('验证码已过期，请重试。'));
          }
        },
        () => {
          if (!stopped) setXaiDeviceError(t('xAI 登录失败，请重试。'));
        },
      );
    }, xaiDevice.intervalSeconds * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [createOpen, t, xaiDevice]);

  useEffect(() => {
    const add = searchParams.get('add');
    if (add === null) return;
    if (add === CLAUDE_SUBSCRIPTION_ADD) setAddingSubscription(true);
    else setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const { scope, machine, setScope } = useSettingsScope(machines);
  const [mountedAt] = useState(() => Date.now());
  const checkedAt = Math.max(
    sourcesQ.dataUpdatedAt,
    providersQ.dataUpdatedAt,
    subscriptionsQ.dataUpdatedAt,
    mountedAt,
  );
  const refreshChecks = () => {
    void sourcesQ.refetch();
    void providersQ.refetch();
    void subscriptionsQ.refetch();
  };

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
            ? { test: () => mutations.testProvider.mutateAsync(record.id) }
            : {}),
          remove: () =>
            mutations.deleteProvider.mutate(record.id, {
              onError: (error) => toastError(t('移除失败，请重试。'), error),
            }),
        }
      : {};

  const announceVerification = (id: string, label: string) => {
    void verification.verify(id).then((outcome) => {
      if (outcome?.ok) toastSuccess(t('「{name}」验证通过', { name: label }));
    });
  };

  const subscriptionActionsFor = (account: SubscriptionAccount): SubscriptionActions => ({
    onRemove: () => setRemovingSubscription(account),
    ...(live
      ? {
          onVerify: () => announceVerification(account.id, account.label),
          ...(subscriptionApiIds.includes(account.id)
            ? {
                onRename: (label: string) =>
                  renameSubscription.mutate(
                    { id: account.id, label },
                    { onError: (error) => toastError(t('重命名失败，请重试。'), error) },
                  ),
              }
            : {}),
        }
      : {}),
  });

  const toggleRuntime = (target: MachineRow) =>
    live && target.id !== undefined
      ? (runtime: MachineRuntime, next: boolean) => {
          const current = (target.enabledRuntimes ?? []).filter(isMachineRuntime);
          const enabledRuntimes = next
            ? [...new Set([...current, runtime])]
            : current.filter((r) => r !== runtime);
          const id = target.id;
          if (id === undefined) return;
          mutations.patchMachine.mutate(
            { id, body: { enabledRuntimes } },
            { onError: (error) => toastError(t('保存失败，请重试。'), error) },
          );
        }
      : undefined;

  const entries =
    machine === undefined
      ? [
          ...subscriptionEntries(subscriptions, {
            now,
            steps: stepsByAccount,
            sticky: stickiness,
            verifications: verification.states,
            actionsFor: subscriptionActionsFor,
            t,
            clock,
          }),
          ...teamEntries(providers, deadModelIds(sources), actionsFor, t),
        ]
      : machineEntries(
          machine,
          sourceFor(machine, sources),
          providers.length,
          toggleRuntime(machine),
          () => setParams({ scope: null, item: null }),
          t,
        );
  const partialFailure = subscriptionsQ.isError
    ? 'subscriptions'
    : providersQ.isError
      ? 'providers'
      : null;
  const itemParam = searchParams.get('item');
  const selected = entries.find((e) => e.item.id === itemParam) ?? entries[0];

  return (
    <PageShell
      route={PROVIDERS_HREF}
      title={t('模型服务')}
      selected={PROVIDERS_HREF}
      fixture={fixture}
    >
      <div className="mx-auto flex w-full max-w-240 flex-col gap-3 pt-4 pb-16">
        <SettingsScopeSentence
          machines={machines}
          scope={scope}
          onChange={(next) => setScope(next, { item: null })}
          trailing={
            <CheckedButton
              updatedAt={checkedAt}
              fetching={sourcesQ.isFetching || providersQ.isFetching || subscriptionsQ.isFetching}
              onRefresh={live ? refreshChecks : undefined}
            />
          }
        />
        {live && machine === undefined && partialFailure !== null && entries.length > 0 && (
          <p
            data-testid="providers-partial-error"
            role="alert"
            className="m-0 flex items-center gap-2 px-1 text-meta text-content-tertiary"
          >
            {partialFailure === 'subscriptions' ? t('订阅账户没能加载') : t('模型服务没能加载')}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void (partialFailure === 'subscriptions' ? subscriptionsQ : providersQ).refetch()
              }
            >
              {t('重试')}
            </Button>
          </p>
        )}
        <ProviderPanel
          header={
            <div className="flex items-center gap-1">
              <h2 className="m-0 text-card-title font-semibold text-foreground">{t('服务商')}</h2>
              {machine === undefined && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('添加服务商')}
                  title={t('添加服务商')}
                  data-testid="resource-new"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus aria-hidden strokeWidth={1.75} />
                </Button>
              )}
            </div>
          }
          items={entries.map((e) => e.item)}
          selectedId={selected?.item.id ?? null}
          onSelect={(id) => setParams({ item: id })}
          empty={
            <QueryBoundary
              query={
                live
                  ? machine === undefined
                    ? mergeQueries(providersQ, subscriptionsQ)
                    : sourcesQ
                  : undefined
              }
              isEmpty
              loadingLabel={t('正在加载模型服务')}
              errorTitle={t('模型服务没能加载')}
              empty={
                <EmptyState
                  testId="providers-empty"
                  icon={Cpu}
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
      {createDialogWanted ? (
        <Suspense fallback={null}>
          <CreateProviderDialog
            open={createOpen}
            onClose={() => {
              setCreateOpen(false);
              setConnectError(null);
              setXaiDevice(null);
              setXaiDeviceError(null);
            }}
            onXaiSignIn={
              live
                ? () => {
                    setXaiDeviceError(null);
                    mutations.startXaiDevice.mutate(undefined, {
                      onSuccess: (started) => setXaiDevice(started),
                      onError: () => setXaiDeviceError(t('xAI 登录失败，请重试。')),
                    });
                  }
                : undefined
            }
            xaiSignInPending={mutations.startXaiDevice.isPending}
            xaiDevice={xaiDevice}
            xaiDeviceError={xaiDeviceError}
            pending={mutations.createProvider.isPending}
            onCreate={
              live
                ? (body) =>
                    mutations.createProvider.mutate(body, {
                      onSuccess: () => setCreateOpen(false),
                      onError: (error) => toastError(t('添加模型服务失败，请重试。'), error),
                    })
                : undefined
            }
            onConnect={
              live
                ? (presetId) => {
                    setConnectError(null);
                    mutations.startProviderOAuth.mutate(presetId, {
                      onSuccess: (data) => window.location.assign(data.authorizationUrl),
                      onError: (err) => setConnectError(err.message),
                    });
                  }
                : undefined
            }
            connectPending={mutations.startProviderOAuth.isPending}
            connectError={connectError}
            onPickClaudeSubscription={
              live
                ? () => {
                    setCreateOpen(false);
                    createSubscription.reset();
                    setAddingSubscription(true);
                  }
                : undefined
            }
          />
        </Suspense>
      ) : null}
      {addingSubscription && (
        <AddClaudeSubscriptionDialog
          onClose={() => {
            createSubscription.reset();
            setAddingSubscription(false);
          }}
          onCreate={(body) =>
            createSubscription.mutate(body, {
              onSuccess: (created) => {
                createSubscription.reset();
                setAddingSubscription(false);
                void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
                setParams({ item: `subscription:${created.id}` }, true);
                announceVerification(created.id, created.label);
              },
            })
          }
          pending={createSubscription.isPending}
          error={createSubscription.isError}
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
            confirmDisabled={deleteSubscription.isPending}
            onCancel={() => setRemovingSubscription(null)}
            onConfirm={() => {
              const target = removingSubscription;
              setRemovingSubscription(null);
              if (target === null || !live) return;
              deleteSubscription.mutate(target.id, {
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
    </PageShell>
  );
}
