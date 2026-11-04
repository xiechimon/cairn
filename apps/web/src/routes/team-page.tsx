import { Grid2x2, Network, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  useApiMutations,
  useChief,
  useMachines,
  useMembers,
  useModelSources,
  useTeams,
  useTodos,
} from '../api/hooks.js';
import { mapMachines, mapTeam, toDisplayTodo, toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON, TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Button, buttonVariants } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { isDeleted } from '../fixtures/deletions.js';
import { TEAM_NAME, TEAM_R7 } from '../fixtures/fixtures.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown } from '../icons/index.js';
import { PageShell } from '../pages/shell.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { CreateAgentDialog } from './create-agent-dialog.js';
import { TeamAgentGrid } from './team-agent-grid.js';
import { TeamChart } from './team-chart.js';

export const TEAM_LAYOUT_STORAGE_KEY = 'cairn.teamMembersLayout';

type TeamLayout = 'grid' | 'chart';

function readStoredLayout(storage: Storage | null): TeamLayout {
  try {
    return storage?.getItem(TEAM_LAYOUT_STORAGE_KEY) === 'chart' ? 'chart' : 'grid';
  } catch {
    return 'grid';
  }
}

export function TeamPage() {
  const { t } = useI18n();
  const { search } = useLocation();
  const fixture = resolveScenario(new URLSearchParams(search));
  const { live, teamId } = useLiveData();
  const membersQ = useMembers(teamId, live);
  const teamsQ = useTeams(live);
  const todosQ = useTodos(teamId, live);
  const team = live && membersQ.data ? mapTeam(membersQ.data) : (fixture.team ?? TEAM_R7);
  const teamName = live ? (teamsQ.data?.[0]?.name ?? TEAM_NAME) : TEAM_NAME;
  const chiefQ = useChief(teamId, live);
  const chiefAgentId = live
    ? (chiefQ.data?.chief.agent?.agentId ?? null)
    : (fixture.chief?.agent?.id ?? null);
  const [layout, setLayout] = useState<TeamLayout>(() => readStoredLayout(safeLocalStorage()));
  const switchLayout = useCallback((next: TeamLayout) => {
    setLayout(next);
    safeSetItem(TEAM_LAYOUT_STORAGE_KEY, next);
  }, []);
  const mutations = useApiMutations(teamId);
  const [createOpen, setCreateOpen] = useState(false);
  const modelSourcesQ = useModelSources(teamId, live);
  const modelOptions = live
    ? toModelOptions(modelSourcesQ.data?.sources ?? [])
    : toModelOptions(fixture.resources?.providerSources ?? []);
  const machinesQ = useMachines(teamId, live);
  const machines = live ? mapMachines(machinesQ.data ?? []) : (fixture.resources?.machines ?? []);
  const cardMachines = live && machinesQ.data === undefined ? undefined : machines;
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
        <>
          <SegmentedTabs
            className="mr-1"
            value={layout}
            onChange={switchLayout}
            options={[
              {
                value: 'grid',
                ariaLabel: 'grid',
                icon: <Grid2x2 aria-hidden strokeWidth={1.75} />,
              },
              {
                value: 'chart',
                ariaLabel: 'chart',
                icon: <Network aria-hidden strokeWidth={1.75} />,
              },
            ]}
          />
          <Link
            className={buttonVariants({ variant: 'ghost', className: TOPBAR_TEXT_BUTTON })}
            to={{ pathname: '/app/account', search }}
            aria-label={t('设置')}
          >
            {t('设置')}
          </Link>
          <Button className={TOPBAR_PRIMARY_BUTTON} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden strokeWidth={1.75} className="size-3.5" />
            {t('创建 Agent')}
          </Button>
        </>
      }
    >
      {layout === 'grid' ? (
        <>
          {team.agents.length > 0 && (
            <p className="m-0 mb-3 text-meta text-content-tertiary">
              {t('{n} 个成员', { n: team.members })}
            </p>
          )}
          <TeamAgentGrid
            agents={team.agents}
            machines={cardMachines}
            search={search}
            isDeleted={isDeleted}
          />
        </>
      ) : (
        <TeamChart agents={team.agents} chiefAgentId={chiefAgentId} />
      )}
      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        modelOptions={modelOptions}
        machines={machines}
        onCreate={
          live
            ? (input) =>
                mutations.createAgent.mutate(input, {
                  onSuccess: () => setCreateOpen(false),
                  onError: (error) => toastError(t('创建 Agent 失败，请重试。'), error),
                })
            : undefined
        }
      />
    </PageShell>
  );
}
