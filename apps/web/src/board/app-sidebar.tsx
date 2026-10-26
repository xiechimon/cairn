// Shared app sidebar (issue #129): the single BoardSidebar call site every
// route family renders, so the rail keeps identical geometry and behavior
// across /app ↔ /app/team ↔ resources ↔ detail hops — the collapse state
// online dot, the attention badge and the ⌘K search row all derive the
// same way everywhere. Routes that mount their own SearchPanel (board and
// detail: their fixture ui.searchOpen open states drive the fixture rows)
// pass searchPanel={false} + their own onSearch opener; every other shell
// rides the internal panel, which renders nothing while closed.
// with their own dialog (board / project) pass onNewTask and keep their
// page-anchored save semantics; every other route rides the internal
// global dialog (useNewTaskSurface, live save path shared with the board).

import { PanelLeft } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMachines, useProjects, useSearchResults, useTodos } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { useNewTaskHotkey } from '../overlay/hotkeys.js';
import { type NewTaskSurfaceApi, NewTaskSurfaceRoot } from '../overlay/new-task-surface-root.js';
import { SearchPanel, useSearchState } from '../overlay/search-panel.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { attentionCount, countInColumn, openCountByProject } from './columns.js';
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
  onNewTask?: () => void;
}

export function AppSidebar({
  fixture,
  selected = 'board',
  todos,
  searchPanel = true,
  onSearch,
  onNewTask,
}: AppSidebarProps) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const projects: SidebarProject[] | undefined = useMemo(() => {
    if (live) return (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    if (fixture.projectNames == null) return undefined;
    return Object.entries(fixture.projectNames).map(([id, name]) => ({ id, name }));
  }, [live, projectsQ.data, fixture.projectNames]);
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
  const projectCounts = useMemo(() => openCountByProject(resolvedTodos), [resolvedTodos]);
  const fixtureMachines = fixture.resources?.machines;
  const machinesOnline = live
    ? (machinesQ.data ?? []).filter((m) => m.online).length
    : fixtureMachines != null
      ? fixtureMachines.filter((m) => m.online === true).length
      : fixture.chief != null
        ? 1
        : 0;
  const internalNewTaskApiRef = useRef<NewTaskSurfaceApi | null>(null);
  const openInternalNewTask = useCallback(() => internalNewTaskApiRef.current?.openDialog(), []);
  const openNewTask = onNewTask ?? openInternalNewTask;
  useNewTaskHotkey(openNewTask);
  const sidebarProps = {
    attention: attentionCount(resolvedTodos),
    running: countInColumn(resolvedTodos, 'building'),
    machinesOnline,
    projectCounts,
    onSearch: onSearch ?? (() => search.setOpen(true)),
    onNewTask: openNewTask,
    usageNav: fixture.usageNav === true,
    selected,
    projects,
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
                onNewTask={() => {
                  closeDrawer();
                  openNewTask();
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
        />
      )}
      {onNewTask == null && <NewTaskSurfaceRoot fixture={fixture} apiRef={internalNewTaskApiRef} />}
    </>
  );
}
