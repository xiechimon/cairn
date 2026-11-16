import type { TeamRoutingSettings } from '@cairn/shared';
import { ChevronRight, Plus } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { toClaudeAccount } from '../api/claude-accounts.js';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { useModelSources, useProviders } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import {
  type ModelRouting,
  type RoutingTargetRow,
  routingTargets,
  ruleGraphGroups,
  useModelRouting,
} from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { useTopModels } from '../api/top-models.js';
import { ClaudeMark } from '../components/brand-marks.js';
import { QueryBoundary } from '../components/query-state.js';
import { QuotaRow } from '../components/settings/quota-row.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { Button } from '../components/ui/button.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { settingsHref } from '../settings/settings-href.js';
import { legacyAccountsSearch, opensLegacyAccounts } from '../settings/settings-redirect.js';
import { MODEL_ROUTING_HREF } from './hrefs.js';
import { providerKind, providerMark } from './provider-editors.js';
import { suggestedTopModels } from './top-models-card.js';

const EMPTY_SETTINGS: TeamRoutingSettings = { rules: [], policies: [] };

function TargetRow({ target }: { target: RoutingTargetRow }) {
  const { t } = useI18n();
  const Mark = target.record === undefined ? ClaudeMark : providerMark(target.record);
  const detail =
    target.record !== undefined
      ? t(providerKind(target.record))
      : target.id.startsWith('subscription:')
        ? [t('Claude 订阅'), target.plan].filter(Boolean).join(' · ')
        : t('执行机上的登录');
  return (
    <Link
      to={{ pathname: settingsHref('providers'), search: `?item=${encodeURIComponent(target.id)}` }}
      replace
      data-testid="routing-provider-row"
      data-routing-provider={target.id}
      className="flex min-h-13 items-center gap-3 border-t border-border px-4 py-2 text-ui text-foreground max-sm:min-h-11 max-sm:gap-2.5 max-sm:px-3 max-sm:text-meta no-underline outline-none first:border-t-0 hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Mark aria-hidden className="size-5 flex-none max-sm:size-4" />
      <span className="flex min-w-0 flex-auto items-baseline gap-2">
        <span className="truncate font-medium">{target.name}</span>
        {detail !== target.name && (
          <span className="truncate text-meta text-content-tertiary max-sm:text-caption">
            {detail}
          </span>
        )}
      </span>
      {target.unavailable && (
        <span className="flex-none rounded-sm border border-border px-1.5 text-caption text-content-tertiary">
          {t('不可用')}
        </span>
      )}
      {!target.unavailable && target.quota != null && (
        <span className="w-32 flex-none">
          {target.quota.fiveHour !== null && (
            <QuotaRow name={target.name} label="5h" left={target.quota.fiveHour} />
          )}
          {target.quota.week !== null && (
            <QuotaRow name={target.name} label={t('周')} left={target.quota.week} />
          )}
        </span>
      )}
      <ChevronRight aria-hidden className="size-4 flex-none text-content-tertiary" />
    </Link>
  );
}

function RoutingContent() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const fixtureAccounts = fixture.resources?.accounts;
  const { live, teamId } = useLiveData();
  const now = live ? Date.now() : fixture.now;

  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const providersQ = useProviders(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const settingsQ = useRoutingSettings(teamId, live);
  const sourcesQ = useModelSources(teamId, live);
  const topModelsQ = useTopModels(teamId, live);

  const routing: ModelRouting | undefined = live
    ? Array.isArray(routingQ.data?.edges)
      ? routingQ.data
      : undefined
    : fixtureAccounts?.routing;
  const targets = routingTargets({
    subscriptions: (live
      ? (subscriptionsQ.data ?? [])
      : (fixtureAccounts?.subscriptions ?? [])
    ).map((wire) => toClaudeAccount(wire, now)),
    providers: live ? (providersQ.data?.providers ?? []) : (fixture.resources?.providers ?? []),
    routing,
  });
  const settings = live
    ? Array.isArray(settingsQ.data?.rules)
      ? settingsQ.data
      : EMPTY_SETTINGS
    : (fixture.resources?.routingSettings ?? EMPTY_SETTINGS);
  const options = toModelOptions(
    live ? (sourcesQ.data?.sources ?? []) : (fixture.resources?.providerSources ?? []),
  );
  const topModels =
    (live ? topModelsQ.data?.models : fixture.resources?.topModels) ?? suggestedTopModels(options);
  const groups = ruleGraphGroups(settings, targets, options, t, topModels);

  return (
    <PageShell
      route={MODEL_ROUTING_HREF}
      title={t('模型路由')}
      selected={MODEL_ROUTING_HREF}
      fixture={fixture}
      actions={
        <Button
          size="sm"
          render={
            <Link to={{ pathname: settingsHref('providers'), search: '?add=provider' }} replace />
          }
          data-testid="routing-add-provider"
        >
          <Plus aria-hidden />
          {t('添加服务商')}
        </Button>
      }
    >
      <QueryBoundary
        query={live ? routingQ : undefined}
        isEmpty={live && routingQ.data === undefined}
        loadingLabel={t('正在加载模型路由')}
        errorTitle={t('模型路由没能加载')}
        empty={null}
      >
        <div className="flex min-w-0 flex-col gap-3 pb-16">
          {targets.length > 0 && (
            <div
              data-testid="routing-providers"
              className="overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)"
            >
              {targets.map((target) => (
                <TargetRow key={target.id} target={target} />
              ))}
            </div>
          )}
          <section data-testid="routing-section" className="mt-5 overflow-x-auto">
            {groups.length === 0 ? (
              <p data-testid="routing-empty" className="m-0 px-1 text-meta text-content-tertiary">
                {t(
                  '还没有路由。添加服务商，再在「模型选择」里给 Coordinator 选模型，这里会画出它走哪个服务商。',
                )}
              </p>
            ) : (
              <div className="min-w-0">
                <RoutingGraph
                  groups={groups}
                  targets={targets.map((target) => ({
                    id: target.id,
                    name: target.name,
                    runtime: target.runtime === 'claude-code' ? 'Claude Code' : 'pi',
                    Mark: target.record === undefined ? ClaudeMark : providerMark(target.record),
                    unavailable: target.unavailable,
                  }))}
                />
              </div>
            )}
          </section>
        </div>
      </QueryBoundary>
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
