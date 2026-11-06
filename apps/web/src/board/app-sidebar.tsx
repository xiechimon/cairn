import { PanelLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useTypeToCompose } from '../overlay/hotkeys.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { recordOutsideLocation } from '../settings/settings-href.js';
import { fleetStatus } from './fleet-status.js';
import { BoardSidebar, type SidebarProject, type SidebarSelected } from './sidebar.js';

export const SIDEBAR_STORAGE_KEY = 'cairn.sidebar-collapsed';

function readCollapsed(storage: Storage | null): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const NARROW_QUERY = '(max-width: 640px)';

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
  const projects: SidebarProject[] | undefined = useMemo(() => {
    if (live) {
      return (projectsQ.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        color: p.color,
        archivedAt: p.archivedAt,
      }));
    }
    if (fixture.projectNames == null) return undefined;
    return Object.entries(fixture.projectNames).map(([id, name]) => ({
      id,
      name,
      ...fixture.projectAvatars?.[id],
    }));
  }, [live, projectsQ.data, fixture.projectNames, fixture.projectAvatars]);
  const projectsPhase = live
    ? queryPhase(withTeamsFailure(projectsQ, teamsQuery), (projectsQ.data ?? []).length === 0)
    : undefined;
  const search = useSearchState(false, '');
  const searchResults = useSearchResults(search.query, live && search.open);
  const [collapsed, setCollapsed] = useState(() => readCollapsed(safeLocalStorage()));
  const narrow = useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(NARROW_QUERY);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const location = useLocation();
  const { key: locationKey } = location;
  useEffect(() => {
    setDrawerOpen(false);
  }, [locationKey]);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      safeSetItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);
  const resolvedTodos = useMemo(
    () => todos ?? (live ? (todosQ.data ?? []).map(toDisplayTodo) : fixture.todos),
    [todos, live, todosQ.data, fixture.todos],
  );
  const fixtureMachines = fixture.resources?.machines;
  const fleet = fleetStatus(live ? (machinesQ.data ?? []) : (fixtureMachines ?? []));
  const machinesOnline =
    live || fixtureMachines != null ? fleet.online : fixture.chief != null ? 1 : 0;
  const { pathname, search: locationSearch } = location;
  useEffect(
    () => recordOutsideLocation(`${pathname}${locationSearch}`),
    [pathname, locationSearch],
  );
  useTypeToCompose();
  const archiveProject = (id: string, archived: boolean) => {
    mutations.setProjectArchived.mutate(
      { id, archived },
      {
        onSuccess: () => {
          if (archived && new URLSearchParams(locationSearch).get('project') === id) {
            navigate({ pathname: '/app' });
          }
        },
        onError: (error) =>
          toastError(t(archived ? '无法归档项目。' : '无法取消归档项目。'), error),
      },
    );
  };
  const sidebarProps = {
    machinesOnline,
    machinesOffline: fleet.offline,
    offlineMachineNames: fleet.offlineNames,
    todos: resolvedTodos,
    onSearch: onSearch ?? (() => search.setOpen(true)),
    usageNav: fixture.usageNav === true,
    selected,
    projects,
    onArchiveProject: live ? archiveProject : undefined,
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
        <BoardSidebar collapsed={collapsed} onToggle={toggle} {...sidebarProps} />
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
