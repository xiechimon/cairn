// Shared app sidebar (issue #129): the single BoardSidebar call site every
// route family renders, so the rail keeps identical geometry and behavior
// across /app ↔ /app/team ↔ resources ↔ detail hops — the collapse state
// (storage-backed, formerly board-only), the 用量 nav row, the machine-
// online dot, the attention badge and the ⌘K search row all derive the
// same way everywhere. Routes that mount their own SearchPanel (board and
// detail: their fixture ui.searchOpen open states drive the fixture rows)
// pass searchPanel={false} + their own onSearch opener; every other shell
// rides the internal panel, which renders nothing while closed.
// #389: the 新任务 row + C hotkey follow the same override law — routes
// with their own dialog (board / project) pass onNewTask and keep their
// page-anchored save semantics; every other route rides the internal
// global dialog (useNewTaskSurface, live save path shared with the board).

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMachines, useProjects, useSearchResults, useTodos } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { type NewTaskSurfaceApi, NewTaskSurfaceRoot } from '../overlay/new-task-surface-root.js';
import { useNewTaskHotkey } from '../overlays/hotkeys.js';
import { SearchPanel, useSearchState } from '../overlays/search-panel.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { attentionCount, countInColumn, openCountByProject } from './columns.js';
import { BoardSidebar, type SidebarProject, type SidebarSelected } from './sidebar.js';

export const SIDEBAR_STORAGE_KEY = 'cairn.sidebar-collapsed'; // mirrored in e2e (sidebar-nav / collapse-family specs)

function readCollapsed(storage: Storage | null): boolean {
  // #1091：null / getItem 抛 = 无记忆，回落展开态（首渲染路径，抛错即全树卸载）。
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface AppSidebarProps {
  fixture: FixtureSet;
  /** Sidebar pill owner (BoardSidebar's slot); defaults to 工作台. */
  selected?: SidebarSelected;
  /** The route's merged todo list — board/detail keep local create/delete
   *  sets; absent = the live query or fixture.todos. */
  todos?: TodoRecord[];
  /** False on routes that mount their own ⌘K panel (board/detail). */
  searchPanel?: boolean;
  /** Search-row opener; defaults to the internal panel. */
  onSearch?: () => void;
  /** #389: 新任务行 + C 热键的 opener（board/project 传本页 dialog）；缺省 =
   *  内部全局 dialog（useNewTaskSurface）。 */
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
  // 侧栏待办徽标 / 面板内容走真 todos（live，TQ 同键去重）或 fixture。
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const machinesQ = useMachines(teamId, live);
  // 侧栏项目组 live 收编：行 = live projectsQ 投影（在途/失败 = []，不闪
  // canon 幻影——空组只留「新建项目」入口）；fixture = scenario projectNames
  // 投影（缺省 undefined → sidebar 内部回退 canon 单行，capture 面字节不变）。
  const projectsQ = useProjects(teamId, live);
  const projects: SidebarProject[] | undefined = useMemo(() => {
    if (live) return (projectsQ.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    if (fixture.projectNames == null) return undefined;
    return Object.entries(fixture.projectNames).map(([id, name]) => ({ id, name }));
  }, [live, projectsQ.data, fixture.projectNames]);
  const search = useSearchState(false, '');
  // W4 #286：live 面服务端搜索（fixture 面不经此钩）。
  const searchResults = useSearchResults(search.query, live && search.open);
  // #55: the collapse toggle is real state, persisted beside the theme; the
  // exact key is [推断] (r2 §1.1 only documents `tds.sidebarProjectsCollapsed`
  // for the project-group fold), and the fixture build injects it like the
  // theme key so the rail capture stays deterministic.
  const [collapsed, setCollapsed] = useState(() => readCollapsed(safeLocalStorage()));
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
  // #389: 内部全局新建 dialog —— 只在路由未传 onNewTask 时渲染（board/
  // project 保自有面）；C 热键与侧栏行共用解析后的 opener，单点注册。
  // XMON-93：面体住隔离根叶子（open/正文态不进侧栏渲染），opener 走 ref。
  const internalNewTaskApiRef = useRef<NewTaskSurfaceApi | null>(null);
  const openInternalNewTask = useCallback(() => internalNewTaskApiRef.current?.openDialog(), []);
  const openNewTask = onNewTask ?? openInternalNewTask;
  useNewTaskHotkey(openNewTask);
  return (
    <>
      <BoardSidebar
        collapsed={collapsed}
        onToggle={toggle}
        attention={attentionCount(resolvedTodos)}
        running={countInColumn(resolvedTodos, 'building')}
        machinesOnline={machinesOnline}
        projectCounts={projectCounts}
        onSearch={onSearch ?? (() => search.setOpen(true))}
        onNewTask={openNewTask}
        usageNav={fixture.usageNav === true}
        selected={selected}
        projects={projects}
      />
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
