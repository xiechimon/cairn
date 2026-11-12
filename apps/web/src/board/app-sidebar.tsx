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
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { markDeleted } from '../fixtures/deletions.js';
import {
  fixtureProjects,
  setFixtureProjectArchived,
  useFixtureArchiveEdits,
} from '../fixtures/project-archive-edits.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useTypeToCompose } from '../overlay/hotkeys.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { toastArchived } from './archive-toast.js';
import { useAttentionTitle } from './attention-title.js';
import { fleetStatus } from './fleet-status.js';
import { setDrawerOpen, useDrawerOpen } from './narrow-drawer.js';
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
  menuTrigger?: boolean;
  hiddenByPanel?: boolean;
}

const SWIPE_CLOSE_PX = 60;
const DRAWER_NAV_TARGETS =
  'a[href], [data-slot="sidebar-nav-row"], [data-slot="sidebar-project-row"]';

function useDrawerSwipeClose(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.dataset.drawerOpen = '';
    let start: { x: number; y: number } | null = null;
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = touch === undefined ? null : { x: touch.clientX, y: touch.clientY };
    };
    const onEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (start === null || touch === undefined) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = null;
      if (dx < -SWIPE_CLOSE_PX && Math.abs(dy) < Math.abs(dx)) setDrawerOpen(false);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      delete root.dataset.drawerOpen;
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [open]);
}

export function AppSidebar({
  fixture,
  selected = 'board',
  todos,
  searchPanel = true,
  onSearch,
  menuTrigger = true,
  hiddenByPanel = false,
}: AppSidebarProps) {
  const { t } = useI18n();
  const { live, teamId, teamsQuery } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mutations = useApiMutations(teamId);
  const navigate = useNavigate();
  const projectsQ = useProjects(teamId, live);
  const [fixtureEdits, setFixtureEdits] = useState<Record<string, Partial<SidebarProject>>>({});
  const archiveEdits = useFixtureArchiveEdits();
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
    if (fixture.projectNames == null && fixture.archivedProjects == null) return undefined;
    return fixtureProjects(fixture, archiveEdits).map((project) => ({
      ...project,
      group: fixture.projectGroups?.[project.id] ?? null,
      ...fixture.projectAvatars?.[project.id],
      ...fixtureEdits[project.id],
    }));
  }, [live, projectsQ.data, fixture, fixtureEdits, archiveEdits]);
  const projectsPhase = live
    ? queryPhase(withTeamsFailure(projectsQ, teamsQuery), (projectsQ.data ?? []).length === 0)
    : undefined;
  const search = useSearchState(false, '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(safeLocalStorage()));
  const narrow = useNarrow();
  const docked = usePanelDocked();
  const drawerOpen = useDrawerOpen() && narrow;
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useDrawerSwipeClose(drawerOpen);
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
  const hidden = hiddenByPanel && panelOpen && railed;
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
    unarchive: (id) =>
      mutations.setProjectArchived.mutate(
        { id, archived: false },
        { onError: (error) => toastError(t('取消归档失败，请重试。'), error) },
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
    removeMany: async (ids) => {
      let refused = 0;
      let firstError: unknown;
      for (const id of ids) {
        try {
          await mutations.deleteProject.mutateAsync(id);
          leaveIfOpen(id);
        } catch (error) {
          refused += 1;
          firstError ??= error;
        }
      }
      if (refused > 0) {
        toastError(t('{n} 个项目没能删除，已留在列表里。', { n: refused }), firstError);
      }
    },
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
      setFixtureProjectArchived(id, Date.now());
      const name = nameOf(id);
      if (name !== undefined) toastArchived(t, name, () => setFixtureProjectArchived(id, null));
      leaveIfOpen(id);
    },
    unarchive: (id) => setFixtureProjectArchived(id, null),
    rename: async (id, name) => editFixture(id, { name }),
    remove: (id) => {
      markDeleted(id);
      editFixture(id, {});
      leaveIfOpen(id);
    },
    removeMany: async (ids) => {
      for (const id of ids) markDeleted(id);
      editFixture('', {});
      for (const id of ids) leaveIfOpen(id);
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
          {menuTrigger && (
            <Button
              variant="ghost"
              size="icon"
              className="app-menu-trigger fixed top-1.5 left-1 z-(--z-floating) size-11 text-content-secondary"
              aria-label={t('展开侧边栏')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <PanelLeft className="size-5.5" strokeWidth={1.75} />
            </Button>
          )}
          <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogContent
              showCloseButton={false}
              initialFocus={(openType) => openType !== 'touch'}
              onClickCapture={(event) => {
                const target = event.target as Element;
                if (target.closest(DRAWER_NAV_TARGETS) != null) closeDrawer();
              }}
              className="app-drawer top-0 left-0 flex h-full w-[85vw] max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none bg-(--sidebar-surface) p-0 ring-0 duration-200 ease-(--ease-standard) sm:max-w-[85vw] data-open:slide-in-from-left data-open:zoom-in-100 data-closed:slide-out-to-left data-closed:zoom-out-100 [&>.board-sidebar]:w-full"
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
      ) : hidden ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                data-testid="sidebar-reopen"
                className="fixed top-2.5 left-2.5 z-(--z-floating) size-7 text-content-tertiary"
                aria-label={t('展开侧边栏')}
                onClick={toggle}
              />
            }
          >
            <PanelLeft className="size-5.5" strokeWidth={1.75} />
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {t('展开侧边栏')}
          </TooltipContent>
        </Tooltip>
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
