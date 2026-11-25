import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  useApiMutations,
  useBackupNotice,
  useChief,
  useMachines,
  useProjects,
  useSearchResults,
  useTasks,
  useTeams,
  useTodos,
} from '../api/hooks.js';
import { mapMachines, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import {
  AntigravityLoginBanner,
  useAntigravityLoginWarnings,
} from '../board/antigravity-login-banner.js';
import { AppSidebar } from '../board/app-sidebar.js';
import type { ArchivedProjectState } from '../board/archived-project-bar.js';
import { artifactTargetOf } from '../board/artifact/artifact-route.js';
import { BackupBanner } from '../board/backup-banner.js';
import { ClaudeLoginBanner, useClaudeLoginWarnings } from '../board/claude-login-banner.js';
import { DevinLoginBanner, useDevinLoginWarnings } from '../board/devin-login-banner.js';
import { holdFirstRunFrame, setupShown } from '../board/first-run-checklist-model.js';
import {
  FirstRunFrame,
  FirstRunSetup,
  firstRunRemembered,
  rememberFirstRun,
  useFirstRunSetup,
} from '../board/first-run-setup.js';
import { type HomeBannerKind, pickHomeBanners } from '../board/home-banners.js';
import { HomeC } from '../board/home-c.js';
import { NotificationBanner, useNotificationBanner } from '../board/notify-banner.js';
import { ProjectNotFound, ProjectsFailed, ProjectsLoading } from '../board/project-not-found.js';
import { type SuggestableProject, suggestProjects } from '../board/project-suggestions.js';
import { QuotaNotice, quotaNoticeInfo } from '../board/quota-notice.js';
import { RemoteUpdateBar } from '../board/remote-update-bar.js';
import { SideChat } from '../board/side-chat.js';
import { THREAD_PARAM } from '../board/thread-copy.js';
import { useCloseThread } from '../board/thread-link.js';
import { usePanelDocked } from '../board/use-narrow.js';
import { useTasksView } from '../board/use-tasks-view.js';
import { PANE_PARAM, paneOf } from '../board/work-panel.js';
import { useChiefRoot } from '../chief/chief-root.js';
import { todoGlanceOf } from '../chief/chief-task-refs.js';
import { toastError } from '../components/ui/toaster.js';
import { TodoGlanceContext } from '../detail/segments.js';
import { withoutClosed } from '../fixtures/deletions.js';
import {
  fixtureProjects,
  setFixtureProjectArchived,
  useFixtureArchiveEdits,
} from '../fixtures/project-archive-edits.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { SHEET_PANEL } from '../pages/shell.js';

export function BoardPage() {
  const [searchParams] = useSearchParams();
  const { live, teamId } = useLiveData();
  const fixture = resolveScenario(searchParams);
  const { t } = useI18n();
  const archiveEdits = useFixtureArchiveEdits();
  const { surface: chief } = useChiefRoot();

  const todosQ = useTodos(teamId, live);
  const tasksQ = useTasks(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const chiefQ = useChief(teamId, live);
  const backupQ = useBackupNotice(live);
  const mutations = useApiMutations(teamId);
  const teamsQ = useTeams(live);

  const homeProjectId = searchParams.get('project');
  const threadId = searchParams.get(THREAD_PARAM);
  const closeThread = useCloseThread();
  const panelDocked = usePanelDocked();
  const liveProject = live ? (projectsQ.data ?? []).find((p) => p.id === homeProjectId) : undefined;
  const fixtureList = useMemo(
    () => (live ? [] : fixtureProjects(fixture, archiveEdits)),
    [live, fixture, archiveEdits],
  );
  const fixtureProject = fixtureList.find((p) => p.id === homeProjectId);
  const fixtureActive = useMemo(
    () => fixtureList.filter((project) => project.archivedAt === null),
    [fixtureList],
  );
  const homeProjectName =
    homeProjectId === null ? null : ((live ? liveProject?.name : fixtureProject?.name) ?? null);
  const homeArchived =
    homeProjectId !== null &&
    (live ? liveProject?.archivedAt != null : fixtureProject?.archivedAt != null);
  const archivedState: ArchivedProjectState | null =
    !homeArchived || homeProjectId === null
      ? null
      : {
          pending: mutations.setProjectArchived.isPending,
          onUnarchive: () => {
            if (!live) {
              setFixtureProjectArchived(homeProjectId, null);
              return;
            }
            mutations.setProjectArchived.mutate(
              { id: homeProjectId, archived: false },
              { onError: (error) => toastError(t('取消归档失败，请重试。'), error) },
            );
          },
        };
  const projectLookup =
    homeProjectId === null || homeProjectName !== null || (!live && fixture.projectNames == null)
      ? 'resolved'
      : live && teamId === undefined && teamsQ.isError
        ? 'failed'
        : !live || projectsQ.data !== undefined
          ? 'unknown'
          : projectsQ.isError
            ? 'failed'
            : 'loading';
  const now = live ? Date.now() : fixture.now;

  const fixtureTodos = useMemo(() => withoutClosed(fixture.todos), [fixture]);
  const liveTodos = useMemo(() => (todosQ.data ?? []).map(toDisplayTodo), [todosQ.data]);
  const todos = live ? liveTodos : fixtureTodos;
  const todoGlances = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todoGlanceOf(todo)])),
    [todos],
  );
  const tasks = useTasksView(fixture);
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

  const quotaInfos = quotaNoticeInfo(todos);
  const backupWarning = backupQ.data ?? null;
  const loginWarnings = useClaudeLoginWarnings(now);
  const devinLoginWarnings = useDevinLoginWarnings(now);
  const antigravityLoginWarnings = useAntigravityLoginWarnings(now);
  const setup = useFirstRunSetup();
  const bannerCandidates: { kind: HomeBannerKind; node: ReactNode }[] = [
    ...(backupWarning != null
      ? [{ kind: 'backup' as const, node: <BackupBanner key="backup" notice={backupWarning} /> }]
      : []),
    ...(loginWarnings.length > 0 ||
    devinLoginWarnings.length > 0 ||
    antigravityLoginWarnings.length > 0
      ? [
          {
            kind: 'login' as const,
            node: (
              <div key="login" className="flex flex-col gap-2">
                <ClaudeLoginBanner warnings={loginWarnings} />
                <DevinLoginBanner warnings={devinLoginWarnings} />
                <AntigravityLoginBanner warnings={antigravityLoginWarnings} />
              </div>
            ),
          },
        ]
      : []),
    ...(quotaInfos != null
      ? [{ kind: 'quota' as const, node: <QuotaNotice key="quota" infos={quotaInfos} /> }]
      : []),
    ...(notifyBanner.visible
      ? [
          {
            kind: 'notify' as const,
            node: (
              <NotificationBanner
                key="notify"
                onEnable={notifyBanner.enable}
                onDismiss={notifyBanner.dismiss}
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
  const setupHome = live && homeProjectId === null && threadId === null;
  const setupDecision = setupShown({
    projects: setup.projects,
    progress: setup.progress,
  });
  const showSetup = setupHome && setupDecision === true;
  useEffect(() => {
    if (setupHome && setupDecision !== undefined) rememberFirstRun(setupDecision);
  }, [setupHome, setupDecision]);
  const openThreadProjectId =
    threadId === null ? null : (todos.find((todo) => todo.id === threadId)?.projectId ?? null);
  const shownProjectId = useRef(homeProjectId);
  useEffect(() => {
    const before = shownProjectId.current;
    shownProjectId.current = homeProjectId;
    if (before === homeProjectId || homeProjectId === null) return;
    if (openThreadProjectId !== null && openThreadProjectId !== homeProjectId) closeThread();
  }, [homeProjectId, openThreadProjectId, closeThread]);
  const homeShown =
    !showSetup &&
    projectLookup !== 'loading' &&
    projectLookup !== 'failed' &&
    !(projectLookup === 'unknown' && homeProjectId !== null);
  const artifactOpen = homeShown && artifactTargetOf(searchParams) !== null;
  const dockThread =
    homeShown &&
    !artifactOpen &&
    threadId !== null &&
    panelDocked &&
    paneOf(searchParams.get(PANE_PARAM)) === 'tasks';
  const sideChat = (docked: boolean) =>
    threadId !== null && (
      <TodoGlanceContext.Provider value={todoGlances}>
        <SideChat
          key={threadId}
          todoId={threadId}
          listed={
            todos.find((todo) => todo.id === threadId) ??
            (!live && todos.length === 1 ? todos[0] : undefined)
          }
          now={live ? Date.now() : fixture.now}
          chatStream={{ items: chief.chiefData.stream ?? [], at: chief.chiefData.streamAt ?? [] }}
          docked={docked}
          onClose={closeThread}
        />
      </TodoGlanceContext.Provider>
    );
  if (
    holdFirstRunFrame({
      setupHome,
      decision: setupDecision,
      projects: setup.projects,
      remembered: firstRunRemembered(),
      failed: setup.failed,
    })
  ) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <FirstRunFrame />
        </div>
        <RemoteUpdateBar />
      </div>
    );
  }
  if (showSetup) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <FirstRunSetup setup={setup} />
        </div>
        <RemoteUpdateBar />
      </div>
    );
  }
  return (
    <div className="board-shell flex h-full overflow-hidden bg-(--surface-1)" data-route="board">
      <AppSidebar
        fixture={fixture}
        todos={todos}
        selected="board"
        searchPanel={false}
        onSearch={() => search.setOpen(true)}
        menuTrigger={!homeShown}
      />
      <div className={`board-sheet flex-col ${SHEET_PANEL}`}>
        <div className="relative flex min-h-0 min-w-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {projectLookup === 'loading' ? (
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
                    params.set('chat', '1');
                    params.delete(THREAD_PARAM);
                    return `/app?${params.toString()}`;
                  }}
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
                machinesQuery={live ? machinesQ : undefined}
                todosQuery={live ? todosQ : undefined}
                tasks={tasks}
                tasksQuery={live ? tasksQ : undefined}
                archived={archivedState}
                fixtureProjects={live ? undefined : fixtureActive}
                {...(dockThread ? { thread: sideChat(true) } : {})}
              />
            )}
          </div>
          {threadId !== null && !artifactOpen && !dockThread && sideChat(false)}
        </div>
        <RemoteUpdateBar />
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
