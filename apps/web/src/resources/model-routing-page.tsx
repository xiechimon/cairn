import type { ClaudeUsage, ProviderRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { type SubscriptionAccount, toClaudeAccount } from '../api/claude-accounts.js';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { useApiMutations, useMachines, useProviders } from '../api/hooks.js';
import { mapMachines } from '../api/mappers.js';
import {
  MODEL_ROUTING_KEY,
  type ModelRouting,
  toRoutingGraph,
  useModelRouting,
} from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { machineLabel } from '../components/machine-label.js';
import { QueryBoundary } from '../components/query-state.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from '../components/settings-list.js';
import { SettingsScopeSentence, useSettingsScope } from '../components/settings-scope.js';
import { toastError } from '../components/ui/toaster.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { settingsHref } from '../settings/settings-href.js';
import { legacyAccountsSearch, opensLegacyAccounts } from '../settings/settings-redirect.js';
import { MODEL_ROUTING_HREF } from './hrefs.js';

const VENDOR_PRESETS: Record<'codex' | 'grok', string> = {
  codex: 'openai-codex',
  grok: 'xai',
};

function providerAccount(record: ProviderRecord, vendor: 'codex' | 'grok'): SubscriptionAccount {
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

function RoutingContent() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const fixtureAccounts = fixture.resources?.accounts;
  const { live, teamId } = useLiveData();
  const client = useQueryClient();
  const now = live ? Date.now() : fixture.now;

  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const providersQ = useProviders(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const mutations = useApiMutations(teamId);

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
  const routing: ModelRouting | undefined = live
    ? Array.isArray(routingQ.data?.edges)
      ? routingQ.data
      : undefined
    : fixtureAccounts?.routing;
  const scopeMachines: MachineRow[] = live
    ? mapMachines(machinesQ.data ?? [])
    : (fixture.resources?.machines ??
      (fixtureAccounts?.machines ?? []).map((m) => ({ id: m.id, name: m.name })));
  const { scope, machine: scopeMachine, setScope } = useSettingsScope(scopeMachines);
  const machineNames = new Map<string, string>(
    live
      ? (machinesQ.data ?? []).map((m) => [m.id, machineLabel(m, machinesQ.data ?? [])])
      : (fixtureAccounts?.machines ?? []).map((m) => [
          m.id,
          machineLabel(m, fixtureAccounts?.machines ?? []),
        ]),
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
      title={t('用量与连接')}
      selected={MODEL_ROUTING_HREF}
      fixture={fixture}
    >
      <div className="flex min-w-0 flex-col gap-3">
        <SettingsScopeSentence machines={scopeMachines} scope={scope} onChange={setScope} />
        {scopeMachine !== undefined && (
          <p data-testid="settings-scope-note" className="m-0 px-1 text-meta text-content-tertiary">
            {t('路由对所有 Runner 生效，{name} 沿用所有 Runner 的设置。', {
              name: scopeMachine.name,
            })}
          </p>
        )}
        <SettingsPanel>
          <div className="p-4">
            <QueryBoundary
              query={live ? routingQ : undefined}
              isEmpty={live && routingQ.data === undefined}
              loadingLabel={t('正在加载用量与连接')}
              errorTitle={t('用量与连接没能加载')}
              empty={null}
            >
              <div className="flex flex-col gap-8 pb-16">
                <SettingsSection title={t('Claude 用量')}>
                  <SettingsCard>
                    <SettingsRow
                      label={t('付费方式')}
                      hint={
                        <span data-testid="claude-usage-hint">
                          {claudeUsage === 'subscription-only'
                            ? t('只用订阅，按 token 付费的 Claude 调用一律拦下，包括后台任务。')
                            : t('订阅不够时，可以改用按 token 付费的 Claude API key。')}
                        </span>
                      }
                      className="flex-wrap gap-y-2 py-2.5"
                    >
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
                </SettingsSection>
                <SettingsSection
                  testId="routing-section"
                  title={t('用途与连接')}
                  description={t('每种用途用哪个模型、走哪个连接')}
                >
                  <div className="overflow-x-auto rounded-(--radius-card) bg-card px-4 py-4 shadow-(--e1)">
                    {graph === null ? (
                      <p className="m-0 text-meta text-content-tertiary">{t('正在读取路由…')}</p>
                    ) : graph.jobs.length === 0 ? (
                      <p
                        data-testid="routing-empty"
                        className="m-0 text-meta text-content-tertiary"
                      >
                        {t('还没有路由，添加一个订阅账户后这里会画出每种用途走哪个连接。')}
                      </p>
                    ) : (
                      <div className="min-w-160">
                        <RoutingGraph jobs={graph.jobs} connections={graph.connections} />
                      </div>
                    )}
                  </div>
                </SettingsSection>
              </div>
            </QueryBoundary>
          </div>
        </SettingsPanel>
      </div>
    </PageShell>
  );
}

export function ModelRoutingPage() {
  const [searchParams] = useSearchParams();
  if (!opensLegacyAccounts(searchParams)) return <RoutingContent />;
  return (
    <Navigate
      to={{
        pathname: settingsHref('providers'),
        search: legacyAccountsSearch(searchParams.toString()),
      }}
      replace
    />
  );
}
