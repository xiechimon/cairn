import { PanelLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  useApiMutations,
  useMachines,
  useProjects,
  useSearchResults,
  useTodos,
} from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { queryPhase, withTeamsFailure } from '../components/query-state.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.js';
import { toastError } from '../components/ui/toaster.js';
import { markDeleted } from '../fixtures/deletions.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useTypeToCompose } from '../overlay/hotkeys.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { toastArchived } from './archive-toast.js';
import { useAttentionTitle } from './attention-title.js';
import { fleetStatus } from './fleet-status.js';
import {
  BoardSidebar,
  type SidebarProject,
  type SidebarProjectActions,
  type SidebarSelected,
} from './sidebar.js';
import { projectStatuses, waitingProjectIds } from './sidebar-projects.js';
import { needsYouBadge } from './tasks-sections.js';
import { THREAD_PARAM } from './thread-copy.js';
import { useNarrow, usePanelDocked } from './use-narrow.js';
import { useTasksView } from './use-tasks-view.js';
import { PANE_PARAM, paneOf } from './work-panel.js';

export const SIDEBAR_STORAGE_KEY = 'cairn.sidebar-collapsed';

export function sidePanelOpen(pathname: string, search: string): boolean {
  if (pathname !== '/app') return false;
  const params = new URLSearchParams(search);
  return paneOf(params.get(PANE_PARAM)) !== null || params.get(THREAD_PARAM) !== null;
}

function readCollapsed(storage: Storage | null): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface AppSidebarProps {
  fixture: FixtureSet;
  selected?: SidebarSelected;
  todos?: TodoRecord[];
  searchPanel?: boolean;
  onSearch?: () => void;
}

export function AppSidebar({
  fixture,
  selected = 'board',
  todos,
  searchPanel = true,
  onSearch,
}: AppSidebarProps) {
  const { t } = useI18n();
  const { live, teamId, teamsQuery } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mutations = useApiMutations(teamId);
  const navigate = useNavigate();
  const projectsQ = useProjects(teamId, live);
  const [fixtureEdits, setFixtureEdits] = useState<Record<string, Partial<SidebarProject>>>({});
  const projects: SidebarProject[] | undefined = useMemo(() => {
    if (live) {
      return (projectsQ.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        color: p.color,
        group: p.group,
        archivedAt: p.archivedAt,
      }));
    }
    if (fixture.projectNames == null) return undefined;
    return Object.entries(fixture.projectNames).map(([id, name]) => ({
      id,
      name,
      group: fixture.projectGroups?.[id] ?? null,
      ...fixture.projectAvatars?.[id],
      ...fixtureEdits[id],
    }));
  }, [
    live,
    projectsQ.data,
    fixture.projectNames,
    fixture.projectGroups,
    fixture.projectAvatars,
    fixtureEdits,
  ]);
  const projectsPhase = live
    ? queryPhase(withTeamsFailure(projectsQ, teamsQuery), (projectsQ.data ?? []).length === 0)
    : undefined;
  const search = useSearchState(false, '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(safeLocalStorage()));
  const narrow = useNarrow();
  const docked = usePanelDocked();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const location = useLocation();
  const { key: locationKey } = location;
  useEffect(() => {
    setDrawerOpen(false);
  }, [locationKey]);
  const panelOpen = docked && sidePanelOpen(location.pathname, location.search);
  const [panelSeen, setPanelSeen] = useState(panelOpen);
  const [folded, setFolded] = useState(panelOpen);
  if (panelSeen !== panelOpen) {
    setPanelSeen(panelOpen);
    setFolded(panelOpen);
  }
  const railed = collapsed || folded;
  const toggle = useCallback(() => {
    const next = !railed;
    setFolded(false);
    setCollapsed(next);
    safeSetItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
  }, [railed]);
  const resolvedTodos = useMemo(
    () => todos ?? (live ? (todosQ.data ?? []).map(toDisplayTodo) : fixture.todos),
    [todos, live, todosQ.data, fixture.todos],
  );
  const tasks = useTasksView(fixture);
  const waiting = useMemo(() => waitingProjectIds(tasks), [tasks]);
  const statuses = useMemo(() => projectStatuses(tasks), [tasks]);
  useAttentionTitle(needsYouBadge(tasks.entries, tasks.questions));
  const fixtureMachines = fixture.resources?.machines;
  const fleet = fleetStatus(live ? (machinesQ.data ?? []) : (fixtureMachines ?? []));
  const machinesOnline =
    live || fixtureMachines != null ? fleet.online : fixture.chief != null ? 1 : 0;
  const { search: locationSearch } = location;
  useTypeToCompose();
  const editFixture = (id: string, patch: Partial<SidebarProject>) =>
    setFixtureEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const leaveIfOpen = (id: string) => {
    const params = new URLSearchParams(locationSearch);
    if (params.get('project') !== id) return;
    params.delete('project');
    navigate({ pathname: '/app', search: `?${params}` });
  };
  const nameOf = (id: string) => projects?.find((project) => project.id === id)?.name;
  const inGroup = (group: string) => (projects ?? []).filter((project) => project.group === group);
  const liveActions: SidebarProjectActions = {
    move: (id, group) =>
      mutations.patchProject.mutate(
        { id, body: { group } },
        { onError: (error) => toastError(t('无法移动项目。'), error) },
      ),
    archive: (id) =>
      mutations.setProjectArchived.mutate(
        { id, archived: true },
        {
          onSuccess: () => {
            const name = nameOf(id);
            if (name !== undefined) {
              toastArchived(t, name, (handlers) =>
                mutations.setProjectArchived.mutate({ id, archived: false }, handlers),
              );
            }
            leaveIfOpen(id);
          },
          onError: (error) => toastError(t('无法归档项目。'), error),
        },
      ),
    rename: async (id, name) => {
      try {
        await mutations.patchProject.mutateAsync({ id, body: { name } });
      } catch (error) {
        toastError(t('无法重命名项目。'), error);
        throw error;
      }
    },
    remove: (id) =>
      mutations.deleteProject.mutate(id, {
        onSuccess: () => leaveIfOpen(id),
        onError: (error) => toastError(t('删除项目失败，请重试。'), error),
      }),
    renameGroup: async (from, to) => {
      try {
        await Promise.all(
          inGroup(from).map((project) =>
            mutations.patchProject.mutateAsync({ id: project.id, body: { group: to } }),
          ),
        );
      } catch (error) {
        toastError(t('无法重命名分组。'), error);
        throw error;
      }
    },
    ungroup: (group) => {
      Promise.all(
        inGroup(group).map((project) =>
          mutations.patchProject.mutateAsync({ id: project.id, body: { group: null } }),
        ),
      ).catch((error: unknown) => toastError(t('无法移动项目。'), error));
    },
  };
  const fixtureActions: SidebarProjectActions = {
    move: (id, group) => editFixture(id, { group }),
    archive: (id) => {
      editFixture(id, { archivedAt: Date.now() });
      const name = nameOf(id);
      if (name !== undefined) toastArchived(t, name, () => editFixture(id, { archivedAt: null }));
      leaveIfOpen(id);
    },
    rename: async (id, name) => editFixture(id, { name }),
    remove: (id) => {
      markDeleted(id);
      editFixture(id, {});
      leaveIfOpen(id);
    },
    renameGroup: async (from, to) => {
      for (const project of inGroup(from)) editFixture(project.id, { group: to });
    },
    ungroup: (group) => {
      for (const project of inGroup(group)) editFixture(project.id, { group: null });
    },
  };
  const sidebarProps = {
    machinesOnline,
    machinesOffline: fleet.offline,
    offlineMachineNames: fleet.offlineNames,
    waiting,
    onSearch: onSearch ?? (() => search.setOpen(true)),
    usageNav: fixture.usageNav === true,
    selected,
    projects,
    statuses,
    actions: live ? liveActions : projects === undefined ? undefined : fixtureActions,
    projectsState:
      projectsPhase === 'loading' || projectsPhase === 'error' ? projectsPhase : undefined,
    onRetryProjects: () => {
      if (projectsQ.data === undefined && teamId === undefined) void teamsQuery?.refetch();
      else void projectsQ.refetch();
    },
  };
  return (
    <>
      {narrow ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="app-menu-trigger fixed top-1.5 left-1 z-(--z-floating) size-11 text-content-secondary"
            aria-label={t('展开侧边栏')}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <PanelLeft className="size-4.5" strokeWidth={1.75} />
          </Button>
          <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogContent
              showCloseButton={false}
              initialFocus={(openType) => openType !== 'touch'}
              onClickCapture={(event) => {
                if ((event.target as Element).closest('a[href]') != null) closeDrawer();
              }}
              className="top-0 left-0 flex h-full w-72 max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none bg-transparent p-0 shadow-xl ring-0 duration-200 ease-(--ease-standard) sm:max-w-[85vw] data-open:slide-in-from-left data-open:zoom-in-100 data-closed:slide-out-to-left data-closed:zoom-out-100 [&>.board-sidebar]:w-full"
            >
              <DialogTitle className="sr-only">{t('侧边栏')}</DialogTitle>
              <BoardSidebar
                {...sidebarProps}
                collapsed={false}
                onToggle={closeDrawer}
                onSearch={() => {
                  closeDrawer();
                  sidebarProps.onSearch();
                }}
              />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <BoardSidebar collapsed={railed} onToggle={toggle} {...sidebarProps} />
      )}
      {searchPanel && (
        <SearchPanel
          open={search.open}
          fixture={live ? { ...fixture, todos: resolvedTodos, now: Date.now() } : fixture}
          query={search.query}
          onQuery={search.setQuery}
          onClose={() => search.setOpen(false)}
          server={live ? searchResults.data : undefined}
          serverQuery={live ? searchResults : undefined}
        />
      )}
    </>
  );
}
