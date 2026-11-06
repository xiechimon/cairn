import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
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
import { ClaudeLoginBanner, useClaudeLoginWarnings } from '../board/claude-login-banner.js';
import { FirstPrCard, firstPrCardInfo } from '../board/first-pr-card.js';
import { type HomeBannerKind, pickHomeBanners } from '../board/home-banners.js';
import { HomeC } from '../board/home-c.js';
import { NotificationBanner, useNotificationBanner } from '../board/notify-banner.js';
import { ProjectHome, type ProjectHomeProject } from '../board/project-home.js';
import { ProjectNotFound, ProjectsFailed, ProjectsLoading } from '../board/project-not-found.js';
import { type SuggestableProject, suggestProjects } from '../board/project-suggestions.js';
import { QuotaBanner, quotaBannerInfo } from '../board/quota-banner.js';
import { SideChat } from '../board/side-chat.js';
import { THREAD_PARAM } from '../board/thread-copy.js';
import { useCloseThread } from '../board/thread-link.js';
import { useChiefRoot } from '../chief/chief-root.js';
import { ChiefSettings } from '../chief/chief-settings.js';
import { withoutDeleted } from '../fixtures/deletions.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';

export function BoardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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
  const threadId = searchParams.get(THREAD_PARAM);
  const closeThread = useCloseThread();
  const homeProjectName =
    homeProjectId === null
      ? null
      : live
        ? ((projectsQ.data ?? []).find((p) => p.id === homeProjectId)?.name ?? null)
        : (fixture.projectNames?.[homeProjectId] ?? null);
  const liveProject = live ? (projectsQ.data ?? []).find((p) => p.id === homeProjectId) : undefined;
  const homeProject: ProjectHomeProject | null =
    homeProjectId === null || homeProjectName === null
      ? null
      : {
          id: homeProjectId,
          name: homeProjectName,
          description: liveProject?.description,
          instructions: liveProject?.instructions,
          repo: liveProject?.githubRepo ?? liveProject?.repoName,
          baseBranch: liveProject?.baseBranch,
          icon: liveProject?.icon ?? fixture.projectAvatars?.[homeProjectId]?.icon,
          color: liveProject?.color ?? fixture.projectAvatars?.[homeProjectId]?.color,
        };
  const projectLookup =
    homeProjectId === null || homeProject !== null || (!live && fixture.projectNames == null)
      ? 'resolved'
      : live && teamId === undefined && teamsQ.isError
        ? 'failed'
        : !live || projectsQ.data !== undefined
          ? 'unknown'
          : projectsQ.isError
            ? 'failed'
            : 'loading';
  const projectChat = searchParams.get('chat') === '1';
  const previousChiefView = useRef(chiefView);
  useEffect(() => {
    const opened = chiefView === 'drawer' && previousChiefView.current !== 'drawer';
    previousChiefView.current = chiefView;
    if (homeProject === null || projectChat || !opened) return;
    const params = new URLSearchParams(searchParams);
    params.set('chat', '1');
    navigate({ pathname: '/app', search: `?${params.toString()}` });
  }, [homeProject, projectChat, chiefView, searchParams, navigate]);
  const schedules = live ? mapSchedules(schedulesQ.data ?? []) : (fixture.schedules ?? []);
  const now = live ? Date.now() : fixture.now;
  const chatParams = new URLSearchParams(searchParams);
  chatParams.set('chat', '1');
  const projectChatHref = `/app?${chatParams.toString()}`;

  const fixtureTodos = useMemo(() => withoutDeleted(fixture.todos), [fixture]);
  const liveTodos = useMemo(() => (todosQ.data ?? []).map(toDisplayTodo), [todosQ.data]);
  const todos = live ? liveTodos : fixtureTodos;
  const machines = useMemo(
    () => (live ? mapMachines(machinesQ.data ?? []) : fixture.resources?.machines),
    [live, machinesQ.data, fixture],
  );

  const knownProjects: SuggestableProject[] = useMemo(() => {
    const lastActive = new Map<string, number>();
    for (const todo of todos) {
      if (todo.projectId == null) continue;
      lastActive.set(todo.projectId, Math.max(lastActive.get(todo.projectId) ?? 0, todo.phaseAt));
    }
    const listed = live
      ? (projectsQ.data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          icon: p.icon,
          color: p.color,
        }))
      : Object.entries(fixture.projectNames ?? {}).map(([id, name]) => ({
          id,
          name,
          ...fixture.projectAvatars?.[id],
        }));
    return listed.map((p) => ({ ...p, lastActiveAt: lastActive.get(p.id) ?? 0 }));
  }, [live, projectsQ.data, fixture, todos]);

  const search = useSearchState(fixture.ui?.searchOpen === true, fixture.ui?.searchQuery ?? '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const notifyBanner = useNotificationBanner(fixture.ui?.notificationBanner === true, live);

  const quotaInfos = quotaBannerInfo(todos);
  const backupWarning = backupQ.data ?? null;
  const loginWarnings = useClaudeLoginWarnings(machines, now);
  const bannerCandidates: { kind: HomeBannerKind; node: ReactNode }[] = [
    ...(backupWarning != null
      ? [{ kind: 'backup' as const, node: <BackupBanner key="backup" notice={backupWarning} /> }]
      : []),
    ...(loginWarnings.length > 0
      ? [
          {
            kind: 'login' as const,
            node: <ClaudeLoginBanner key="login" warnings={loginWarnings} />,
          },
        ]
      : []),
    ...(quotaInfos != null
      ? [{ kind: 'quota' as const, node: <QuotaBanner key="quota" infos={quotaInfos} /> }]
      : []),
    ...(notifyBanner.visible
      ? [
          {
            kind: 'notify' as const,
            node: <NotificationBanner key="notify" onEnable={notifyBanner.enable} />,
          },
        ]
      : []),
    ...(firstPrCard != null
      ? [
          {
            kind: 'first-pr' as const,
            node: (
              <FirstPrCard
                key="first-pr"
                info={firstPrCard}
                onDismiss={() =>
                  mutations.patchTeam.mutate({ firstPrReportPrompt: { dismissed: true } })
                }
              />
            ),
          },
        ]
      : []),
  ];
  const picked = pickHomeBanners(bannerCandidates);
  const homeBanner =
    picked.length === 0 ? undefined : (
      <div className="flex flex-col gap-2">{picked.map((entry) => entry.node)}</div>
    );
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
        <div className="relative flex min-h-0 min-w-0 flex-1">
          {chiefView === 'settings' ? (
            <ChiefSettings
              chief={chiefData}
              onBack={() => setChiefView('drawer')}
              machines={fixture.resources?.machines}
            />
          ) : projectLookup === 'loading' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ProjectsLoading />
            </div>
          ) : projectLookup === 'failed' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ProjectsFailed
                retrying={teamsQ.isFetching || projectsQ.isFetching}
                onRetry={() => {
                  if (teamId === undefined) {
                    void teamsQ.refetch();
                    return;
                  }
                  void projectsQ.refetch();
                }}
              />
            </div>
          ) : projectLookup === 'unknown' && homeProjectId !== null ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ProjectNotFound
                unknownId={homeProjectId}
                suggestions={suggestProjects(homeProjectId, knownProjects)}
                projectHref={(id) => {
                  const params = new URLSearchParams(searchParams);
                  params.set('project', id);
                  params.delete('chat');
                  params.delete(THREAD_PARAM);
                  return `/app?${params.toString()}`;
                }}
              />
            </div>
          ) : homeProject !== null && !projectChat ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ProjectHome
                key={homeProject.id}
                project={homeProject}
                todos={todos}
                schedules={schedules}
                now={now}
                chatHref={projectChatHref}
              />
            </div>
          ) : (
            <HomeC
              surface={chief}
              todos={todos}
              now={now}
              projectId={homeProjectName === null ? null : homeProjectId}
              projectName={homeProjectName}
              banner={homeBanner}
              machines={machines}
              coordinatorMachineId={live ? (chiefQ.data?.agentActor?.machineId ?? null) : null}
              schedules={schedules}
              machinesQuery={live ? machinesQ : undefined}
              todosQuery={live ? todosQ : undefined}
              schedulesQuery={live ? schedulesQ : undefined}
            />
          )}
        </div>
        {threadId !== null && (
          <SideChat
            key={threadId}
            todoId={threadId}
            listed={
              todos.find((todo) => todo.id === threadId) ??
              (!live && todos.length === 1 ? todos[0] : undefined)
            }
            now={live ? Date.now() : fixture.now}
            onClose={closeThread}
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
        serverQuery={live ? searchResults : undefined}
      />
    </div>
  );
}
