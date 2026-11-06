import { Route } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTeams, useTodos } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { buttonVariants } from '../components/ui/button.js';
import { TEAM_NAME } from '../fixtures/fixtures.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import { ROUTING_SETTINGS_HREF } from '../resources/routing-settings-page.js';

export function TeamPage() {
  const { t } = useI18n();
  const { search } = useLocation();
  const navigate = useNavigate();
  const fixture = resolveScenario(new URLSearchParams(search));
  const { live, teamId } = useLiveData();
  const teamsQ = useTeams(live);
  const todosQ = useTodos(teamId, live);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? TEAM_NAME) : TEAM_NAME;
  return (
    <PageShell
      route="team"
      fixture={live ? { ...fixture, todos: (todosQ.data ?? []).map(toDisplayTodo) } : fixture}
      selected="team"
      title={
        <span className="inline-flex items-center gap-1.5">
          {teamName}
          <ChevronDown width={12} height={12} className="text-content-tertiary" />
        </span>
      }
      actions={
        <Link
          className={buttonVariants({ variant: 'ghost', className: TOPBAR_TEXT_BUTTON })}
          to={{ pathname: '/app/account', search }}
          aria-label={t('设置')}
        >
          {t('设置')}
        </Link>
      }
    >
      <EmptyState
        icon={Route}
        title={t('Agent 已由路由规则取代')}
        description={t('模型、机器和权限现在由工作路由规则与工作策略决定。')}
        action={{ label: t('打开工作路由'), onClick: () => navigate(ROUTING_SETTINGS_HREF) }}
        testId="team-agents-removed"
      />
    </PageShell>
  );
}
