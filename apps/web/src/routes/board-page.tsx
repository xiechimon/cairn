import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  useApiMutations,
  useBackupNotice,
  useChief,
  useMachines,
  useProjects,
  useSchedules,
  useSearchResults,
  useTeams,
  useTodos,
} from '../api/hooks.js';
import { mapMachines, mapSchedules, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { AppSidebar } from '../board/app-sidebar.js';
import { BackupBanner } from '../board/backup-banner.js';
import { FirstPrCard, firstPrCardInfo } from '../board/first-pr-card.js';
import { HomeC } from '../board/home-c.js';
import { NotificationBanner, useNotificationBanner } from '../board/notify-banner.js';
import {
  ProjectHomeMock,
  ProjectHybridHeader,
  projectPageMockOf,
} from '../board/project-page-mocks.js';
import { QuotaBanner, quotaBannerInfo } from '../board/quota-banner.js';
import { useChiefRoot } from '../chief/chief-root.js';
import { ChiefSettings } from '../chief/chief-settings.js';
import { withoutDeleted } from '../fixtures/deletions.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';

export function BoardPage() {
  const [searchParams] = useSearchParams();
  const { live, teamId } = useLiveData();
  const fixture = resolveScenario(searchParams);
  const { surface: chief } = useChiefRoot();
  const { chiefView, setChiefView, chiefData } = chief;

  const todosQ = useTodos(teamId, live);
  const schedulesQ = useSchedules(live);
  const projectsQ = useProjects(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const chiefQ = useChief(teamId, live);
  const backupQ = useBackupNotice(live);
  const mutations = useApiMutations(teamId);
  const teamsQ = useTeams(live);
  const team = live ? teamsQ.data?.[0] : undefined;
  const firstPrCard =
    team?.firstPrReportPrompt === undefined
      ? null
      : firstPrCardInfo(team.firstPrReportPrompt, team.createdAt);

  const homeProjectId = searchParams.get('project');
  const mock = live ? null : projectPageMockOf(searchParams.get('mock'));
  const homeProjectName =
    homeProjectId === null
      ? null
      : live
        ? ((projectsQ.data ?? []).find((p) => p.id === homeProjectId)?.name ?? null)
        : (fixture.projectNames?.[homeProjectId] ?? null);

  const fixtureTodos = useMemo(() => withoutDeleted(fixture.todos), [fixture]);
  const liveTodos = useMemo(() => (todosQ.data ?? []).map(toDisplayTodo), [todosQ.data]);
  const todos = live ? liveTodos : fixtureTodos;
  const machines = useMemo(
    () => (live ? mapMachines(machinesQ.data ?? []) : fixture.resources?.machines),
    [live, machinesQ.data, fixture],
  );

  const search = useSearchState(fixture.ui?.searchOpen === true, fixture.ui?.searchQuery ?? '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const notifyBanner = useNotificationBanner(fixture.ui?.notificationBanner === true, live);

  const quotaInfos = quotaBannerInfo(todos);
  const backupWarning = backupQ.data ?? null;
  const homeBanner =
    backupWarning != null ? (
      <BackupBanner notice={backupWarning} />
    ) : firstPrCard != null ? (
      <FirstPrCard
        info={firstPrCard}
        onDismiss={() => mutations.patchTeam.mutate({ firstPrReportPrompt: { dismissed: true } })}
      />
    ) : quotaInfos != null ? (
      <QuotaBanner infos={quotaInfos} />
    ) : notifyBanner.visible ? (
      <NotificationBanner onEnable={notifyBanner.enable} />
    ) : undefined;
  return (
    <div className="board-shell flex h-full overflow-hidden bg-(--surface-1)" data-route="board">
      <AppSidebar
        fixture={fixture}
        todos={todos}
        selected={chiefView === 'settings' ? 'none' : 'board'}
        searchPanel={false}
        onSearch={() => search.setOpen(true)}
      />
      <div className={`board-sheet ${SHEET_PANEL}`}>
        {chiefView === 'settings' ? (
          <ChiefSettings
            chief={chiefData}
            onBack={() => setChiefView('drawer')}
            machines={fixture.resources?.machines}
          />
        ) : mock === 'home' && homeProjectId !== null && homeProjectName !== null ? (
          <ProjectHomeMock
            projectId={homeProjectId}
            projectName={homeProjectName}
            todos={todos}
            now={fixture.now}
          />
        ) : (
          <HomeC
            surface={chief}
            todos={todos}
            now={live ? Date.now() : fixture.now}
            projectId={homeProjectName === null ? null : homeProjectId}
            projectName={homeProjectName}
            banner={homeBanner}
            machines={machines}
            coordinatorMachineId={live ? (chiefQ.data?.agentActor?.machineId ?? null) : null}
            schedules={live ? mapSchedules(schedulesQ.data ?? []) : (fixture.schedules ?? [])}
            {...(mock === 'hybrid' && homeProjectId !== null && homeProjectName !== null
              ? {
                  projectHeader: (
                    <ProjectHybridHeader
                      projectId={homeProjectId}
                      projectName={homeProjectName}
                      todos={todos}
                      now={fixture.now}
                    />
                  ),
                }
              : {})}
          />
        )}
      </div>
      <SearchPanel
        open={search.open}
        fixture={live ? { ...fixture, todos, now: Date.now() } : fixture}
        query={search.query}
        onQuery={search.setQuery}
        onClose={() => search.setOpen(false)}
        server={live ? searchResults.data : undefined}
      />
    </div>
  );
}
