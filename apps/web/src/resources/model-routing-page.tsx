import type { TeamRoutingSettings } from '@cairn/shared';
import { Plus } from 'lucide-react';
import { Navigate, useSearchParams } from 'react-router';
import { toClaudeAccount } from '../api/claude-accounts.js';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { toDevinAccount, useDevinSubscriptions } from '../api/devin-subscriptions.js';
import { useModelSources, useProjects, useProviders } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import {
  type ModelRouting,
  routingTargets,
  ruleGraphGroups,
  useModelRouting,
} from '../api/model-routing.js';
import { useLiveData } from '../api/provider.js';
import { useRoutingSettings } from '../api/routing-settings.js';
import { ClaudeMark, DevinMark } from '../components/brand-marks.js';
import { QueryBoundary } from '../components/query-state.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { Button } from '../components/ui/button.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { PageShell } from '../pages/shell.js';
import { settingsHref } from '../settings/settings-href.js';
import { legacyAccountsSearch, opensLegacyAccounts } from '../settings/settings-redirect.js';
import { MODEL_ROUTING_HREF } from './hrefs.js';
import { providerMark } from './provider-editors.js';
import { ProvidersSection } from './providers-page.js';
import { ModelRulesSection } from './routing-settings-page.js';

const EMPTY_SETTINGS: TeamRoutingSettings = { rules: [], policies: [] };

function RoutingContent() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const fixtureAccounts = fixture.resources?.accounts;
  const { live, teamId } = useLiveData();
  const now = live ? Date.now() : fixture.now;

  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const devinSubscriptionsQ = useDevinSubscriptions(teamId, live);
  const providersQ = useProviders(teamId, live);
  const routingQ = useModelRouting(teamId, live);
  const settingsQ = useRoutingSettings(teamId, live);
  const sourcesQ = useModelSources(teamId, live);
  const projectsQ = useProjects(teamId, live);

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
    devinSubscriptions: (live
      ? (devinSubscriptionsQ.data ?? [])
      : (fixtureAccounts?.devinSubscriptions ?? [])
    ).map((wire) => toDevinAccount(wire, now)),
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
  const projectChoices = (projectsQ.data ?? []).flatMap((project) =>
    (['coordinator', 'session'] as const).flatMap((use) => {
      const choice = project.modelOverrides?.[use];
      return choice == null
        ? []
        : [
            {
              id: `${project.id}:${use}`,
              name: `${project.name} · ${use === 'coordinator' ? 'Coordinator' : t('任务')}`,
              choice,
            },
          ];
    }),
  );
  const groups = ruleGraphGroups(settings, targets, options, t, projectChoices);

  return (
    <PageShell
      route={MODEL_ROUTING_HREF}
      title={t('模型')}
      selected={MODEL_ROUTING_HREF}
      fixture={fixture}
      actions={
        <Button
          size="sm"
          className="pointer-coarse:h-11"
          onClick={() =>
            setSearchParams(
              (params) => {
                params.set('add', 'provider');
                return params;
              },
              { replace: true },
            )
          }
          data-testid="routing-add-provider"
        >
          <Plus aria-hidden />
          {t('添加服务商')}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-8 pb-16">
        <ModelRulesSection />
        <section className="flex min-w-0 flex-col gap-3">
          <h3 className="m-0 text-ui font-semibold text-foreground">{t('服务商')}</h3>
          <ProvidersSection />
        </section>
        <QueryBoundary
          query={live ? routingQ : undefined}
          isEmpty={live && routingQ.data === undefined}
          loadingLabel={t('正在加载模型路由')}
          errorTitle={t('模型路由没能加载')}
          empty={null}
        >
          {groups.length > 0 && (
            <section data-testid="routing-section" className="min-w-0 overflow-x-auto">
              <RoutingGraph
                groups={groups}
                targets={targets.map((target) => ({
                  id: target.id,
                  name: target.name,
                  runtime:
                    target.runtime === 'claude-code'
                      ? 'Claude Code'
                      : target.runtime === 'devin'
                        ? 'Devin'
                        : 'pi',
                  Mark:
                    target.record === undefined
                      ? target.runtime === 'devin'
                        ? DevinMark
                        : ClaudeMark
                      : providerMark(target.record),
                  unavailable: target.unavailable,
                }))}
              />
            </section>
          )}
        </QueryBoundary>
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
        pathname: settingsHref('routing'),
        search: legacyAccountsSearch(searchParams.toString()),
      }}
      replace
    />
  );
}
