import { BRAND, type ProjectColor, type ProjectIcon } from '@cairn/shared';
import {
  Box,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Clock,
  EllipsisVertical,
  Inbox,
  KeyRound,
  Layers,
  type LucideIcon,
  PanelLeft,
  Plug,
  Plus,
  Puzzle,
  Search,
  Server,
} from 'lucide-react';
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useApiMutations, useArchivedTodos, useNotifications } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import { SidebarUser } from '../components/shell/sidebar-user.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { blockDemoWrite, DEMO_MODE } from '../demo/demo-gate.js';
import { UserMenu } from '../detail/user-menu.js';
import {
  isDeleted,
  isThreadArchived,
  markDeleted,
  markRenamed,
  subscribeFixtureThreads,
  withRenamedTitles,
  withResolved,
} from '../fixtures/deletions.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { subscribeFixtureSnooze, withFixtureSnooze } from '../fixtures/snooze.js';
import { isFixtureUnread, setFixtureUnread, subscribeFixtureUnread } from '../fixtures/unread.js';
import { scrollFadeClassName, useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { FOCUS_RING_INSET } from '../lib/focus-ring.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { readStoredTheme } from '../theme.js';
import { withColumnParam } from './columns.js';
import { withoutBoardView } from './home.js';
import { ProjectAvatar } from './project-avatar.js';
import { RenameThreadDialog } from './rename-dialog.js';
import {
  ArchivedThreadGroup,
  ProjectGroup,
  projectThreads,
  SnoozedThreadGroup,
  threadHref,
} from './sidebar-threads.js';
import { SnoozeConfirmDialog, SnoozePickDialog } from './snooze-dialogs.js';
import type { SnoozeChoice, SnoozeRequest } from './snooze-presets.js';
import { keepThreadUnread } from './thread-read-keep.js';
import { useThreadActions } from './use-thread-actions.js';

export type SidebarSelected =
  | 'board'
  | 'kanban'
  | 'schedules'
  | 'team'
  | 'none'
  | '/app/resources/skills'
  | '/app/resources/mcp-servers'
  | '/app/resources/secrets'
  | '/app/resources/machines'
  | '/app/resources/providers';

export interface SidebarProject {
  id: string;
  name: string;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
}

const CANON_PROJECT: SidebarProject = { id: PROJECT_ID, name: PROJECT_NAME };

interface BoardSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  attention?: number;
  machinesOnline?: number;
  onSearch?: () => void;
  onNewTask: () => void;
  usageNav?: boolean;
  selected?: SidebarSelected;
  projects?: SidebarProject[];
  todos?: TodoRecord[];
  fixtureUnreadIds?: string[];
}

interface ResourceRow {
  label: string;
  href: string;
  Icon: LucideIcon;
}

const RESOURCE_ROWS: ResourceRow[] = [
  { label: '技能', href: '/app/resources/skills', Icon: Puzzle },
  { label: 'MCP', href: '/app/resources/mcp-servers', Icon: Plug },
  { label: '密钥', href: '/app/resources/secrets', Icon: KeyRound },
  { label: '机器', href: '/app/resources/machines', Icon: Server },
  { label: '模型服务', href: '/app/resources/providers', Icon: Layers },
];

const USAGE_ROW: ResourceRow = { label: '用量', href: '/app/usage', Icon: ChartColumn };

export const GROUP_STORAGE_KEYS = {
  project: 'cairn.sidebarProjectsCollapsed',
  resource: 'cairn.sidebarResourcesCollapsed',
} as const;

type GroupId = keyof typeof GROUP_STORAGE_KEYS;

function readGroupCollapsed(storage: Storage | null): Record<GroupId, boolean> {
  try {
    return {
      project: storage?.getItem(GROUP_STORAGE_KEYS.project) === '1',
      resource: storage?.getItem(GROUP_STORAGE_KEYS.resource) !== '0',
    };
  } catch {
    return { project: false, resource: true };
  }
}

const ICON = 'size-4.5 flex-none';
const STROKE = 1.75;

export function BrandMark({ className = 'size-4' }: { className?: string }) {
  return (
    <span
      data-testid="brand-mark"
      aria-hidden="true"
      className={`sidebar-brand-mark block flex-none ${className}`}
      style={{
        backgroundColor: 'currentColor',
        WebkitMask: 'url("/logo-mark.svg") center / 100% no-repeat',
        mask: 'url("/logo-mark.svg") center / 100% no-repeat',
      }}
    />
  );
}

const FOCUS =
  'outline-none focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:outline-offset-2';

const SEARCH_OPEN_DIM =
  '[html[data-search-open]_&]:bg-transparent [html[data-search-open]_&]:shadow-none [html[data-search-open]_&]:ring-0 [html[data-search-open]_&]:text-content-secondary';

const SEARCH_OPEN_DIM_CURRENT =
  '[html[data-search-open]_&_[aria-current=page]]:bg-transparent [html[data-search-open]_&_[aria-current=page]]:text-content-secondary';

const ROW = `flex h-9 w-full flex-none items-center gap-2.5 rounded-(--cds-radius-lg) px-2.5 text-left text-ui font-medium text-foreground no-underline transition-[background-color,color] duration-150 ease-out ${FOCUS_RING_INSET}`;
const ROW_IDLE = 'hover:bg-sidebar-hover hover:text-foreground';
const ROW_ACTIVE = `bg-(--hover-1) font-semibold text-foreground [&>svg:first-child]:text-(--card-button) ${SEARCH_OPEN_DIM}`;

const ROW_BTN =
  'justify-start border-none dark:hover:bg-sidebar-hover active:not-aria-[haspopup]:translate-y-0';

const ICON_BTN = `size-7 flex-none cursor-pointer rounded-(--radius-control) border-none bg-transparent p-0 text-content-tertiary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover active:not-aria-[haspopup]:translate-y-0 ${FOCUS}`;

const RAIL_ROW = `rail-row relative flex size-8 flex-none items-center justify-center rounded-(--cds-radius-lg) text-content-tertiary no-underline transition-[background-color,box-shadow,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-foreground ${FOCUS_RING_INSET}`;
const RAIL_ACTIVE = `bg-(--hover-1) text-(--card-button) hover:bg-(--hover-1) hover:text-(--card-button) ${SEARCH_OPEN_DIM}`;
const RAIL_BTN =
  'cursor-pointer border-none bg-transparent p-0 dark:hover:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:text-content-tertiary aria-expanded:hover:bg-sidebar-hover aria-expanded:hover:text-foreground active:not-aria-[haspopup]:translate-y-0';

function UserMenuPopover({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
}) {
  const { t } = useI18n();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="top"
        align="start"
        alignOffset={0}
        sideOffset={4}
        collisionPadding={8}
        collisionAvoidance={{ align: 'none' }}
        aria-label={t('用户菜单')}
        className="block w-auto rounded-none border-none bg-transparent p-0 shadow-none ring-0"
      >
        <UserMenu floating theme={readStoredTheme(safeLocalStorage())} />
      </PopoverContent>
    </Popover>
  );
}

function AttentionBadge({ count }: { count: number }) {
  return (
    <span
      data-testid="attention-badge"
      className="ml-auto min-w-5 flex-none rounded-full bg-(--card-button) px-1.5 text-center text-caption leading-4 font-semibold tabular-nums text-(--text-on-accent)"
    >
      {count}
    </span>
  );
}

export function BoardSidebar({
  collapsed = false,
  onToggle,
  attention = 0,
  machinesOnline = 0,
  onSearch,
  onNewTask,
  usageNav = false,
  selected = 'board',
  projects,
  todos,
  fixtureUnreadIds,
}: BoardSidebarProps) {
  const { t } = useI18n();
  const { user, live, teamId } = useLiveData();
  const navigate = useNavigate();
  const mutations = useApiMutations(teamId);
  const threadActions = useThreadActions();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeFixtureUnread(refresh), []);
  useEffect(() => subscribeFixtureSnooze(refresh), []);
  useEffect(() => subscribeFixtureThreads(refresh), []);
  const [pendingDelete, setPendingDelete] = useState<TodoRecord | null>(null);
  const [pendingSnooze, setPendingSnooze] = useState<TodoRecord | null>(null);
  const [pendingPick, setPendingPick] = useState<TodoRecord | null>(null);
  const [pendingRename, setPendingRename] = useState<TodoRecord | null>(null);
  const { search, pathname } = useLocation();
  const stripped = withoutBoardView(withColumnParam(search, null));
  const baseParams = new URLSearchParams(stripped.startsWith('?') ? stripped.slice(1) : stripped);
  const homeParams = new URLSearchParams(baseParams);
  if (DEMO_MODE) homeParams.set('view', 'home');
  const plain = `?${baseParams}`;
  const homeSearch = `?${homeParams}`;
  const projectRows = useMemo(
    () => (projects ?? [CANON_PROJECT]).filter((row) => !isDeleted(row.id)),
    [projects],
  );
  const archivedQ = useArchivedTodos(teamId, live);
  const knownThreads = live
    ? (todos ?? [])
    : withResolved(withFixtureSnooze(withRenamedTitles(todos ?? []))).filter(
        (todo) => !isDeleted(todo.id),
      );
  const openThreads = knownThreads.filter((todo) => !isThreadArchived(todo) && !isDeleted(todo.id));
  const archivedThreads = live
    ? (archivedQ.data ?? []).map(toDisplayTodo).filter((todo) => !isDeleted(todo.id))
    : knownThreads.filter((todo) => isThreadArchived(todo));
  const liveThreads = openThreads.filter((todo) => todo.snoozeMode == null);
  const snoozedThreads = openThreads.filter((todo) => todo.snoozeMode != null);
  const activeThreadId = pathname.startsWith('/app/todo/')
    ? (pathname.split('/')[3] ?? null)
    : null;
  const notificationsQ = useNotifications(teamId, live);
  const unreadIds = new Set(
    live
      ? (notificationsQ.data?.unreadThreadIds ?? [])
      : liveThreads
          .filter((todo) => isFixtureUnread(todo.id, fixtureUnreadIds))
          .map((todo) => todo.id),
  );
  const setThreadRead = (id: string, read: boolean) => {
    if (live) {
      mutations.setThreadRead.mutate({ id, read });
      return;
    }
    setFixtureUnread(id, !read);
  };
  const markThreadUnread = (todo: TodoRecord) => {
    if (!live && blockDemoWrite()) return;
    if (todo.id === activeThreadId) keepThreadUnread(todo.id);
    setThreadRead(todo.id, false);
  };
  const resourceRows = usageNav
    ? [...RESOURCE_ROWS.slice(0, 4), USAGE_ROW, ...RESOURCE_ROWS.slice(4)]
    : RESOURCE_ROWS;
  const resourceActive = resourceRows.some((row) => row.href === selected);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [groupCollapsed, setGroupCollapsed] = useState(() =>
    readGroupCollapsed(safeLocalStorage()),
  );
  const toggleGroup = useCallback((id: GroupId) => {
    setGroupCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      safeSetItem(GROUP_STORAGE_KEYS[id], next[id] ? '1' : '0');
      return next;
    });
  }, []);
  const navRef = useRef<HTMLElement | null>(null);
  useScrollFade(navRef, { enabled: !collapsed });
  const resourceListId = useId();
  const homeLabel = attention > 0 ? `${t('工作台')} ${attention}` : t('工作台');

  const goTo = (target: string) => navigate({ pathname: target, search: plain });
  const unarchiveThread = (todo: TodoRecord) => threadActions.unarchive([todo]);
  const unsnoozeThread = (todo: TodoRecord) => threadActions.unsnooze([todo]);
  const applySnooze = (todo: TodoRecord, request: SnoozeRequest) =>
    threadActions.snooze([todo], request);
  const chooseSnooze = (todo: TodoRecord, choice: SnoozeChoice) => {
    if (choice === 'needed') setPendingSnooze(todo);
    else if (choice === 'pick') setPendingPick(todo);
    else applySnooze(todo, choice);
  };
  const archiveThread = (todo: TodoRecord) => threadActions.archive([todo]);
  const renameThread = (todo: TodoRecord, title: string) => {
    setPendingRename(null);
    if (!live) {
      if (blockDemoWrite()) return;
      markRenamed(todo.id, title);
      refresh();
      return;
    }
    mutations.patchTodo.mutate(
      { id: todo.id, body: { title } },
      { onError: (error) => toastError(t('无法重命名线程。'), error) },
    );
  };
  const confirmDeleteThread = () => {
    const todo = pendingDelete;
    setPendingDelete(null);
    if (todo == null) return;
    const leave = () => {
      if (activeThreadId === todo.id) goTo('/app');
    };
    if (live) {
      mutations.deleteTodo.mutate(todo.id, {
        onSuccess: leave,
        onError: (error) => toastError(t('删除任务失败，请重试。'), error),
      });
      return;
    }
    if (blockDemoWrite()) return;
    markDeleted(todo.id);
    refresh();
    leave();
  };

  const userAvatar = (
    <SeededAvatar
      className="size-6"
      name={user.displayName}
      src={user.avatarUrl}
      fallback="/avatar-user.png"
    />
  );

  if (collapsed) {
    const railLink = (
      to: { pathname: string; search: string },
      active: boolean,
      label: string,
    ) => ({
      className: `${RAIL_ROW} ${active ? `rail-row--selected ${RAIL_ACTIVE}` : ''}`,
      to,
      'aria-current': active ? ('page' as const) : undefined,
      'aria-label': label,
    });
    return (
      <aside className="board-sidebar board-sidebar--collapsed relative z-(--z-docked) flex w-10 flex-none flex-col items-center gap-px border-r border-border bg-(--surface-1) pt-2 pb-2">
        <Button
          variant="ghost"
          className={`rail-toggle ${RAIL_ROW} ${RAIL_BTN}`}
          aria-label={t('展开侧边栏')}
          onClick={onToggle}
        >
          <PanelLeft className={ICON} strokeWidth={STROKE} />
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className={`${RAIL_ROW} ${RAIL_BTN}`}
                aria-label={t('搜索')}
                onClick={onSearch}
              >
                <Search className={ICON} strokeWidth={STROKE} />
              </Button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            <Kbd>⌘K</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className={`sidebar-new-task ${RAIL_ROW} ${RAIL_BTN} text-(--card-button)`}
                aria-label={t('新任务')}
                onClick={onNewTask}
              >
                <Plus className={ICON} strokeWidth={STROKE} />
              </Button>
            }
          />
          <TooltipContent side="right" sideOffset={8}>
            <Kbd>C</Kbd>
          </TooltipContent>
        </Tooltip>
        <nav className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto">
          <Link
            {...railLink(
              { pathname: '/app', search: homeSearch },
              selected === 'board' || selected === 'kanban',
              homeLabel,
            )}
          >
            <Inbox className={ICON} strokeWidth={STROKE} />
            {attention > 0 && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-(--card-button)" />
            )}
          </Link>
          <Link
            {...railLink(
              { pathname: '/app/schedules', search: plain },
              selected === 'schedules',
              t('定时'),
            )}
          >
            <Clock className={ICON} strokeWidth={STROKE} />
          </Link>
          <Button
            variant="ghost"
            className={`rail-group group mt-2 ${RAIL_ROW} ${RAIL_BTN} ${groupCollapsed.project ? 'rail-group--collapsed' : ''}`}
            aria-label={t(groupCollapsed.project ? '展开{label}' : '收起{label}', {
              label: t('项目'),
            })}
            aria-expanded={!groupCollapsed.project}
            onClick={() => toggleGroup('project')}
          >
            <ChevronDown
              className="size-3.5 transition-transform duration-150 group-[.rail-group--collapsed]:-rotate-90"
              strokeWidth={STROKE}
            />
          </Button>
          {!groupCollapsed.project &&
            projectRows.map((row, i) => {
              const href = `/app/project/${row.id}`;
              return (
                <Link
                  key={row.id}
                  {...railLink({ pathname: href, search: plain }, pathname === href, row.name)}
                >
                  <ProjectAvatar name={row.name} tone={i} icon={row.icon} color={row.color} bare />
                </Link>
              );
            })}
        </nav>
        <Button
          variant="ghost"
          className={`rail-group group ${RAIL_ROW} ${RAIL_BTN} ${groupCollapsed.resource ? 'rail-group--collapsed' : ''} ${groupCollapsed.resource && resourceActive ? RAIL_ACTIVE : ''}`}
          aria-label={t(groupCollapsed.resource ? '展开{label}' : '收起{label}', {
            label: t('资源'),
          })}
          aria-expanded={!groupCollapsed.resource}
          onClick={() => toggleGroup('resource')}
        >
          <Box className={ICON} strokeWidth={STROKE} />
        </Button>
        {!groupCollapsed.resource &&
          resourceRows.map(({ label, href, Icon }) => (
            <Link
              key={href}
              {...railLink({ pathname: href, search: plain }, selected === href, t(label))}
            >
              <Icon className={ICON} strokeWidth={STROKE} />
            </Link>
          ))}
        <UserMenuPopover
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          trigger={
            <Button
              variant="ghost"
              className={`rail-user mt-1 h-9 w-8 ${RAIL_BTN} hover:bg-sidebar-hover aria-expanded:bg-transparent [&_img]:block [&_img]:size-6 [&_img]:rounded-full`}
              aria-label={user.displayName}
            >
              {userAvatar}
            </Button>
          }
        />
      </aside>
    );
  }

  return (
    <aside
      className={`board-sidebar relative z-(--z-docked) flex w-(--sidebar-w) flex-none flex-col overflow-hidden border-r border-border bg-(--surface-1) px-3 pt-3 pb-2.5 ${SEARCH_OPEN_DIM_CURRENT}`}
    >
      <div
        data-testid="team-row"
        className="sidebar-team-row flex h-11 flex-none items-center gap-0.5 text-foreground"
      >
        <Link
          className={`sidebar-team-name flex h-11 min-w-0 flex-1 items-center gap-2 rounded-(--cds-radius-lg) px-2 text-foreground no-underline transition-[background-color,box-shadow] duration-150 ease-out ${FOCUS} ${
            selected === 'team'
              ? `sidebar-team-row--active bg-(--sidebar-active) hover:bg-(--sidebar-active) dark:hover:bg-(--sidebar-active) ${SEARCH_OPEN_DIM}`
              : 'hover:bg-sidebar-hover'
          }`}
          to={{ pathname: '/app/team', search: plain }}
          aria-current={selected === 'team' ? 'page' : undefined}
        >
          <BrandMark className="size-5.5" />
          <span className="truncate font-heading text-page font-title">{BRAND.manifestName}</span>
          <ChevronDown
            aria-hidden
            className="size-3.5 flex-none text-content-tertiary"
            strokeWidth={STROKE}
          />
        </Link>
        <Button
          variant="ghost"
          className={`sidebar-team-collapse ${ICON_BTN}`}
          aria-label={t('收起侧边栏')}
          onClick={onToggle}
        >
          <PanelLeft className="size-4" strokeWidth={STROKE} />
        </Button>
      </div>

      <div className="mt-2 flex flex-none flex-col gap-px">
        <div className="sidebar-new-task">
          <SidebarNavRow
            icon={<Plus className="size-4" strokeWidth={STROKE} />}
            label={t('新任务')}
            shortcut="C"
            onClick={onNewTask}
          />
        </div>
        <SidebarNavRow
          icon={<Search className="size-4" strokeWidth={STROKE} />}
          label={t('搜索')}
          shortcut="⌘K"
          onClick={onSearch}
        />
        <div className="relative">
          <SidebarNavRow
            icon={<Inbox className="size-4" strokeWidth={STROKE} />}
            label={t('工作台')}
            active={selected === 'board' || selected === 'kanban'}
            onClick={() => navigate({ pathname: '/app', search: homeSearch })}
          />
          {attention > 0 && (
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
              <AttentionBadge count={attention} />
            </span>
          )}
        </div>
        <SidebarNavRow
          icon={<Clock className="size-4" strokeWidth={STROKE} />}
          label={t('定时')}
          active={selected === 'schedules'}
          onClick={() => goTo('/app/schedules')}
        />
      </div>

      <nav
        ref={navRef}
        className={`mt-3 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto ${scrollFadeClassName()}`}
      >
        <div
          data-testid="project-group"
          className="mb-0.5 flex h-6 flex-none items-center pr-1 pl-2.5 text-caption font-medium text-content-tertiary"
        >
          <Button
            variant="ghost"
            className={`sidebar-group group h-6 cursor-pointer gap-1 rounded-(--radius-control) border-none bg-transparent px-0 text-caption font-medium text-content-tertiary hover:bg-transparent hover:text-content-secondary dark:hover:bg-transparent aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 ${FOCUS} ${
              groupCollapsed.project ? 'sidebar-group--collapsed' : ''
            }`}
            aria-expanded={!groupCollapsed.project}
            onClick={() => toggleGroup('project')}
          >
            {t('项目')}
            <ChevronDown
              aria-hidden
              className="sidebar-group-chevron size-3 text-content-dim transition-transform duration-150 group-[.sidebar-group--collapsed]:-rotate-90"
              strokeWidth={STROKE}
            />
          </Button>
          <Link
            className={`ml-auto flex size-6 items-center justify-center rounded-(--radius-control) text-content-tertiary hover:bg-sidebar-hover hover:text-foreground ${FOCUS}`}
            to={{ pathname: '/app/project/new', search: plain }}
            aria-label={t('新建项目')}
          >
            <Plus className="size-3.5" strokeWidth={STROKE} />
          </Link>
        </div>
        {!groupCollapsed.project &&
          projectRows.map((row, i) => {
            const href = `/app/project/${row.id}`;
            return (
              <ProjectGroup
                key={row.id}
                name={row.name}
                tone={i}
                icon={row.icon}
                color={row.color}
                active={pathname === href}
                activeThreadId={activeThreadId}
                threads={projectThreads(liveThreads, row.id)}
                unreadIds={unreadIds}
                onOpenProject={() => goTo(href)}
                onOpenThread={(todo) => goTo(threadHref(todo.id))}
                onMarkUnread={markThreadUnread}
                onRename={setPendingRename}
                onSnooze={chooseSnooze}
                onArchive={archiveThread}
                onDelete={setPendingDelete}
              />
            );
          })}
        {!groupCollapsed.project && (
          <SnoozedThreadGroup
            threads={snoozedThreads}
            activeThreadId={activeThreadId}
            onOpenThread={(todo) => goTo(threadHref(todo.id))}
            onUnsnooze={unsnoozeThread}
          />
        )}
        {!groupCollapsed.project && (
          <ArchivedThreadGroup
            threads={archivedThreads}
            activeThreadId={activeThreadId}
            onOpenThread={(todo) => goTo(threadHref(todo.id))}
            onUnarchive={unarchiveThread}
          />
        )}
      </nav>

      <div className="flex flex-none flex-col gap-px pt-2">
        <Button
          variant="ghost"
          className={`sidebar-group group ${ROW} ${ROW_BTN} cursor-pointer aria-expanded:bg-transparent aria-expanded:hover:bg-sidebar-hover ${
            groupCollapsed.resource ? 'sidebar-group--collapsed' : ''
          } ${groupCollapsed.resource && resourceActive ? ROW_ACTIVE : `${ROW_IDLE} bg-transparent`}`}
          aria-expanded={!groupCollapsed.resource}
          aria-controls={resourceListId}
          data-active={groupCollapsed.resource && resourceActive ? 'true' : undefined}
          onClick={() => toggleGroup('resource')}
        >
          <Box className={ICON} strokeWidth={STROKE} />
          <span className="flex-1 truncate">{t('资源')}</span>
          <ChevronRight
            aria-hidden
            className="sidebar-group-chevron size-3.5 text-content-dim transition-transform duration-150 group-aria-expanded:rotate-90"
            strokeWidth={STROKE}
          />
        </Button>
        {!groupCollapsed.resource && (
          <div
            id={resourceListId}
            className="mb-1 ml-4 flex flex-col gap-px border-l border-border pl-1.5"
          >
            {resourceRows.map(({ label, href, Icon }) => (
              <Link
                key={href}
                className={`sidebar-subrow ${ROW} ${selected === href ? ROW_ACTIVE : ROW_IDLE}`}
                to={{ pathname: href, search: plain }}
                aria-current={selected === href ? 'page' : undefined}
              >
                <Icon className={ICON} strokeWidth={STROKE} />
                <span className="min-w-0 flex-1 truncate">{t(label)}</span>
                {machinesOnline > 0 && label === '机器' && (
                  <span
                    data-testid="online-dot"
                    className="size-1.5 flex-none rounded-full bg-running"
                  />
                )}
              </Link>
            ))}
          </div>
        )}

        <UserMenuPopover
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          trigger={
            <Button
              variant="ghost"
              className="sidebar-user mt-1 h-auto w-full flex-none cursor-pointer justify-start rounded-(--cds-radius-lg) border-none bg-transparent p-0 font-normal hover:bg-sidebar-hover dark:hover:bg-sidebar-hover aria-expanded:bg-sidebar-hover [&>div]:w-full"
              aria-label={user.displayName}
            >
              <SidebarUser
                avatar={userAvatar}
                name={user.displayName}
                machinesOnline={machinesOnline}
                action={
                  <EllipsisVertical
                    className="size-3.5 text-content-tertiary"
                    strokeWidth={STROKE}
                  />
                }
              />
            </Button>
          }
        />
      </div>
      <SnoozeConfirmDialog
        open={pendingSnooze != null}
        onClose={() => setPendingSnooze(null)}
        onConfirm={() => {
          const todo = pendingSnooze;
          setPendingSnooze(null);
          if (todo != null) applySnooze(todo, 'needed');
        }}
      />
      {pendingPick != null && (
        <SnoozePickDialog
          open
          onClose={() => setPendingPick(null)}
          onConfirm={(at) => {
            const todo = pendingPick;
            setPendingPick(null);
            applySnooze(todo, at);
          }}
        />
      )}
      {pendingRename != null && (
        <RenameThreadDialog
          initialTitle={pendingRename.title}
          onClose={() => setPendingRename(null)}
          onSave={(title) => renameThread(pendingRename, title)}
        />
      )}
      <DeleteConfirm
        open={pendingDelete != null}
        title={t('确定删除该任务？此操作不可撤销。')}
        summary={
          <>
            <span className="text-(--text-tertiary)">#{pendingDelete?.seqNum}</span>
            {pendingDelete?.title}
          </>
        }
        ariaLabel={t('删除任务')}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDeleteThread}
      />
    </aside>
  );
}
