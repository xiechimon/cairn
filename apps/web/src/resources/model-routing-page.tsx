import type { RouteUse, TeamRoutingSettings } from '@cairn/shared';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import {
  toAntigravityAccount,
  useAntigravitySubscriptions,
} from '../api/antigravity-subscriptions.js';
import { toClaudeAccount } from '../api/claude-accounts.js';
import { useClaudeSubscriptions } from '../api/claude-subscriptions.js';
import { toDevinAccount, useDevinSubscriptions } from '../api/devin-subscriptions.js';
import { toDoubaoAccount, useDoubaoSubscriptions } from '../api/doubao-subscriptions.js';
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
import { PROVIDERS } from '../components/accounts/account-parts.js';
import { AntigravityMark, ClaudeMark, DevinMark, DoubaoMark } from '../components/brand-marks.js';
import { QueryBoundary } from '../components/query-state.js';
import { RouteUseGlyph } from '../components/route-use-glyph.js';
import { RoutingGraph } from '../components/settings/routing-graph.js';
import { ProjectGlyph } from '../components/shell/sidebar-project.js';
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

const GRAPH_LEAD_USES: readonly RouteUse[] = ['coordinator', 'session', 'review', 'compaction'];

const SUBSCRIPTION_MARKS = {
  'claude-code': ClaudeMark,
  devin: DevinMark,
  antigravity: AntigravityMark,
  doubao: DoubaoMark,
} as const;

function RoutingContent() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const fixtureAccounts = fixture.resources?.accounts;
  const { live, teamId } = useLiveData();
  const now = live ? Date.now() : fixture.now;

  const subscriptionsQ = useClaudeSubscriptions(teamId, live);
  const devinSubscriptionsQ = useDevinSubscriptions(teamId, live);
  const antigravitySubscriptionsQ = useAntigravitySubscriptions(teamId, live);
  const doubaoSubscriptionsQ = useDoubaoSubscriptions(teamId, live);
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
    subscriptions: live
      ? (subscriptionsQ.data ?? []).map((wire) => toClaudeAccount(wire, now))
      : (fixtureAccounts?.subscriptions ?? []),
    devinSubscriptions: live
      ? (devinSubscriptionsQ.data ?? []).map((wire) => toDevinAccount(wire, now))
      : (fixtureAccounts?.devinSubscriptions ?? []),
    antigravitySubscriptions: live
      ? (antigravitySubscriptionsQ.data ?? []).map((wire) => toAntigravityAccount(wire, now))
      : (fixtureAccounts?.antigravitySubscriptions ?? []),
    doubaoSubscriptions: live
      ? (doubaoSubscriptionsQ.data?.subscriptions ?? []).map((wire) => toDoubaoAccount(wire))
      : (fixtureAccounts?.doubaoSubscriptions ?? []),
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
  const projects = projectsQ.data ?? [];
  const projectChoices = projects.flatMap((project) => {
    const choice = project.modelOverrides?.coordinator;
    return choice == null
      ? []
      : [{ id: `${project.id}:coordinator`, name: `${project.name} · Coordinator`, choice }];
  });
  const leads = new Map<string, ReactNode>([
    ...GRAPH_LEAD_USES.map((use) => [use, <RouteUseGlyph key={use} use={use} />] as const),
    ...projects.map(
      (project) =>
        [
          `project:${project.id}:coordinator`,
          <ProjectGlyph
            key={project.id}
            icon={project.icon}
            name={project.name}
            className="size-4"
          />,
        ] as const,
    ),
  ]);
  const groups = ruleGraphGroups(settings, targets, options, t, projectChoices).map((group) => ({
    ...group,
    nodes: group.nodes.map((node) => ({ ...node, lead: leads.get(node.id) })),
  }));

  return (
    <PageShell
      route={MODEL_ROUTING_HREF}
      title={t('模型')}
      selected={MODEL_ROUTING_HREF}
      fixture={fixture}
      actions={
        <Button
          variant="outline"
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
          <h3 className="m-0 text-heading font-title text-foreground">{t('服务商')}</h3>
          <ProvidersSection />
        </section>
        <QueryBoundary
          query={live ? routingQ : undefined}
          isEmpty={live && routingQ.data === undefined}
          loadingLabel={t('正在加载路由图')}
          errorTitle={t('路由图未能加载')}
          empty={null}
        >
          {groups.length > 0 && (
            <section data-testid="routing-section" className="min-w-0 overflow-x-auto">
              <RoutingGraph
                groups={groups}
                targets={targets.map((target) => ({
                  id: target.id,
                  name: target.name,
                  runtime: PROVIDERS[target.runtime].label,
                  RuntimeMark: PROVIDERS[target.runtime].Mark,
                  Mark:
                    target.record === undefined
                      ? SUBSCRIPTION_MARKS[target.runtime === 'pi' ? 'claude-code' : target.runtime]
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
