import type { ClaudeUsage, ProviderRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ACCOUNT_VENDORS,
  type AccountStep,
  type AccountVendor,
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
} from '../api/claude-subscriptions.js';
import { api } from '../api/client.js';
import { useApiMutations, useMachines, useProviders } from '../api/hooks.js';
import {
  MODEL_ROUTING_KEY,
  type ModelRouting,
  toRoutingGraph,
  useModelRouting,
} from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { SettingsCard, SettingsRow, SettingsSegmented } from '../components/settings-list.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { SubscriptionAccounts } from './accounts-view.js';
import { AddClaudeSubscriptionDialog } from './claude-subscriptions.js';
import { PROVIDERS_HREF } from './providers-page.js';

export const MODEL_ROUTING_HREF = '/app/resources/model-routing';

const VENDOR_PRESETS: Record<Exclude<AccountVendor, 'claude'>, string> = {
  codex: 'openai-codex',
  grok: 'xai',
};

function providerAccount(record: ProviderRecord, vendor: AccountVendor): SubscriptionAccount {
  return {
    id: record.id,
    vendor,
    label: record.label,
    expiresAt: null,
    createdAt: record.createdAt,
    plan: null,
    state: 'ok',
    cooldownUntil: null,
    windows: [],
    lastUsedAt: null,
    stepsLast24h: null,
  };
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
      <h2 className="m-0 text-card-title font-medium text-foreground">{title}</h2>
      {hint !== undefined && <span className="text-meta text-content-tertiary">{hint}</span>}
    </div>
  );
}

export function ModelRoutingPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const vendorParam = searchParams.get('vendor');
  const vendor: AccountVendor = ACCOUNT_VENDORS.find((v) => v === vendorParam) ?? 'claude';
  const fixture = resolveScenario(searchParams);
  const fixtureAccounts = fixture.resources?.accounts;
  const { live, teamId } = useLiveData();
  const client = useQueryClient();
  const now = live ? Date.now() : fixture.now;

  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const providersQ = useProviders(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const stickinessQ = useClaudeSubscriptionStickiness(teamId, live);
  const subscriptionIds = (subscriptionsQ.data ?? []).map((s) => s.id);
  const renamableIds = new Set(
    live ? (subscriptionsQ.data ?? []).filter((s) => s.state !== undefined).map((s) => s.id) : [],
  );
  const stepsQ = useClaudeSubscriptionSteps(teamId, subscriptionIds, live);
  const createSubscription = useCreateClaudeSubscription(teamId);
  const deleteSubscription = useDeleteClaudeSubscription(teamId);
  const renameSubscription = useRenameClaudeSubscription(teamId);
  const mutations = useApiMutations(teamId);

  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SubscriptionAccount | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  const providers = providersQ.data?.providers ?? [];
  const accounts: SubscriptionAccount[] = live
    ? [
        ...(subscriptionsQ.data ?? []).map((wire) => toClaudeAccount(wire, now)),
        ...providers.flatMap((record) =>
          record.providerId === VENDOR_PRESETS.codex
            ? [providerAccount(record, 'codex')]
            : record.providerId === VENDOR_PRESETS.grok
              ? [providerAccount(record, 'grok')]
              : [],
        ),
      ]
    : [
        ...(fixtureAccounts?.subscriptions ?? []).map((wire) => toClaudeAccount(wire, now)),
        ...(fixtureAccounts?.otherAccounts ?? []),
      ];
  const stepsByAccount: Record<string, AccountStep[]> = live
    ? Object.fromEntries(
        subscriptionIds.flatMap((id, index) => {
          const page = stepsQ[index]?.data;
          return page == null || !Array.isArray(page.steps) ? [] : [[id, page.steps]];
        }),
      )
    : (fixtureAccounts?.stepsByAccount ?? {});
  const stickiness = live ? (stickinessQ.data?.threads ?? []) : (fixtureAccounts?.stickiness ?? []);
  const routing: ModelRouting | undefined = live
    ? Array.isArray(routingQ.data?.edges)
      ? routingQ.data
      : undefined
    : fixtureAccounts?.routing;
  const machineNames = new Map<string, string>(
    live
      ? (machinesQ.data ?? []).map((m) => [m.id, m.name])
      : (fixtureAccounts?.machines ?? []).map((m) => [m.id, m.name]),
  );
  const graph =
    routing === undefined
      ? null
      : toRoutingGraph(routing, {
          accounts,
          providers: live ? providers : (fixtureAccounts?.providers ?? []),
          machineNames,
          t,
        });
  const claudeUsage: ClaudeUsage = routing?.settings.claudeUsage ?? 'subscription-only';

  const verify = async (account: SubscriptionAccount) => {
    if (!live) return;
    setVerifying(account.id);
    try {
      const result = await api.post<{ ok: boolean }>(
        `/api/teams/${teamId}/claude-subscriptions/${account.id}/verify`,
      );
      if (result.ok) toastSuccess(t('「{name}」验证通过', { name: account.label }));
      else toastError(t('「{name}」验证失败', { name: account.label }), null);
    } catch (error) {
      toastError(t('「{name}」验证失败', { name: account.label }), error);
    } finally {
      setVerifying(null);
    }
  };

  const setClaudeUsage = (next: ClaudeUsage) => {
    if (!live) return;
    mutations.patchTeam.mutate(
      { claudeUsage: next },
      {
        onSuccess: () => void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] }),
        onError: (error) => toastError(t('保存失败，请重试。'), error),
      },
    );
  };

  return (
    <PageShell
      route={MODEL_ROUTING_HREF}
      title={t('模型路由')}
      selected={MODEL_ROUTING_HREF}
      fixture={fixture}
    >
      <div className="flex flex-col gap-10 pb-16">
        <SubscriptionAccounts
          accounts={accounts}
          stepsByAccount={stepsByAccount}
          stickiness={stickiness}
          now={now}
          vendor={vendor}
          onVendorChange={(next) => {
            const params = new URLSearchParams(searchParams);
            params.set('vendor', next);
            setSearchParams(params, { replace: true });
          }}
          onAdd={(vendor) => {
            if (vendor === 'claude') {
              createSubscription.reset();
              setAdding(true);
              return;
            }
            const params = new URLSearchParams(searchParams);
            params.set('add', VENDOR_PRESETS[vendor]);
            navigate({ pathname: PROVIDERS_HREF, search: params.toString() });
          }}
          statusFor={(account) =>
            verifying === account.id ? (
              <span role="status" className="text-meta text-content-tertiary">
                {t('验证中…')}
              </span>
            ) : null
          }
          actionsFor={(account) => {
            const onRemove = () => setRemoving(account);
            if (account.vendor !== 'claude') {
              return {
                onRemove,
                ...(live
                  ? {
                      onRename: (label: string) =>
                        mutations.patchProvider.mutate(
                          { id: account.id, body: { label } },
                          { onError: (error) => toastError(t('重命名失败，请重试。'), error) },
                        ),
                    }
                  : {}),
              };
            }
            return {
              onRemove,
              onVerify: () => void verify(account),
              ...(renamableIds.has(account.id)
                ? {
                    onRename: (label: string) =>
                      renameSubscription.mutate(
                        { id: account.id, label },
                        { onError: (error) => toastError(t('重命名失败，请重试。'), error) },
                      ),
                  }
                : {}),
            };
          }}
        />
        <section className="flex flex-col gap-2">
          <SectionHead title={t('Claude 用量')} />
          <SettingsCard>
            <SettingsRow label={t('付费方式')} className="flex-wrap gap-y-2 py-2.5">
              <SettingsSegmented
                label={t('Claude 用量')}
                value={claudeUsage}
                onChange={setClaudeUsage}
                options={[
                  { value: 'subscription-only', label: t('只用订阅') },
                  { value: 'allow-paid', label: t('允许按量付费') },
                ]}
              />
            </SettingsRow>
          </SettingsCard>
          <p data-testid="claude-usage-hint" className="m-0 px-1 text-meta text-content-tertiary">
            {claudeUsage === 'subscription-only'
              ? t('只用订阅，按 token 付费的 Claude 调用一律拦下，包括后台任务。')
              : t('订阅不够时，可以改用按 token 付费的 Claude API key。')}
          </p>
        </section>
        <section data-testid="routing-section" className="flex flex-col gap-2">
          <SectionHead title={t('路由')} hint={t('每种用途用哪个模型、走哪个连接')} />
          <div className="overflow-x-auto rounded-(--radius-card) bg-card px-4 py-4 shadow-(--e1)">
            {graph === null ? (
              <p className="m-0 text-meta text-content-tertiary">{t('正在读取路由…')}</p>
            ) : graph.jobs.length === 0 ? (
              <p data-testid="routing-empty" className="m-0 text-meta text-content-tertiary">
                {t('还没有路由，添加一个订阅账户后这里会画出每种用途走哪个连接。')}
              </p>
            ) : (
              <div className="min-w-160">
                <RoutingGraph jobs={graph.jobs} connections={graph.connections} />
              </div>
            )}
          </div>
        </section>
      </div>
      {adding && (
        <AddClaudeSubscriptionDialog
          onClose={() => {
            createSubscription.reset();
            setAdding(false);
          }}
          onCreate={(body) => {
            if (!live) return;
            createSubscription.mutate(body, {
              onSuccess: () => {
                createSubscription.reset();
                setAdding(false);
                void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] });
              },
            });
          }}
          pending={createSubscription.isPending}
          error={createSubscription.isError}
        />
      )}
      <AlertDialogShell
        title={t('移除「{name}」？', { name: removing?.label ?? '' })}
        ariaLabel={t('移除账户')}
        open={removing !== null}
        onClose={() => setRemoving(null)}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('移除')}
            confirmDisabled={deleteSubscription.isPending}
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const target = removing;
              setRemoving(null);
              if (target === null || !live) return;
              if (target.vendor === 'claude') {
                deleteSubscription.mutate(target.id, {
                  onSuccess: () =>
                    void client.invalidateQueries({ queryKey: [MODEL_ROUTING_KEY, teamId] }),
                  onError: (error) => toastError(t('移除失败，请重试。'), error),
                });
              } else {
                mutations.deleteProvider.mutate(target.id, {
                  onError: (error) => toastError(t('移除失败，请重试。'), error),
                });
              }
            }}
          />
        }
      >
        <p className="m-0">{t('移除后，后续步骤不再使用这个账户。')}</p>
      </AlertDialogShell>
    </PageShell>
  );
}
