// Board sidebar, Paper Grouped layout (apps/web/DESIGN.md 侧栏): workspace
// row, 新任务 button, 工作台 / 需要我处理 / 定时, 项目 group, then the folded
// 资源 row and the user row pinned to the bottom. The collapsed rail is the
// icon-only twin of the same rows. Class aliases (board-sidebar, sidebar-*,
// rail-*) stay as e2e carriers.

import { BRAND } from '@pacman/shared';
import {
  Box,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Columns3,
  EllipsisVertical,
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
import { type ReactElement, useCallback, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { UserMenu } from '../detail/user-menu.js';
import { isDeleted } from '../fixtures/deletions.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import { scrollFadeClassName, useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { readStoredTheme } from '../theme.js';
import { withColumnParam } from './columns.js';
import { ProjectAvatar } from './project-avatar.js';

/** Which row carries the active face: a nav row, the workspace row on
 *  team/account, a 资源 subrow by href, or none. Project rows match by
 *  pathname instead of a named slot. */
export type SidebarSelected =
  | 'board'
  | 'attention'
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
}

/** Fallback row while the scenario carries no project list. */
const CANON_PROJECT: SidebarProject = { id: PROJECT_ID, name: PROJECT_NAME };

interface BoardSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  /** 待处理 column count: the 需要我处理 badge. */
  attention?: number;
  /** 执行中 column count: the user row's second line. */
  running?: number;
  /** Online machines: the user row's second line and the 机器 row dot. */
  machinesOnline?: number;
  onSearch?: () => void;
  /** Shared with the C hotkey (AppSidebar resolves the dialog). */
  onNewTask: () => void;
  usageNav?: boolean;
  selected?: SidebarSelected;
  /** Live = projectsQ projection ([] while in flight); absent = canon row. */
  projects?: SidebarProject[];
  /** Unfinished todos per project id. */
  projectCounts?: ReadonlyMap<string, number>;
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

/** Fold keys. 项目: "1" folded, absent open. 资源: "0" open, absent folded
 *  (the Grouped layout folds resources by default). */
export const GROUP_STORAGE_KEYS = {
  project: 'pacman.sidebarProjectsCollapsed',
  resource: 'pacman.sidebarResourcesCollapsed',
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

const ICON = 'size-4 flex-none';
const STROKE = 1.75;

const FOCUS =
  'outline-none focus-visible:[outline:2px_solid_var(--focus-ring)] focus-visible:outline-offset-2';

/** The ⌘K panel is the only lit surface while open (#137): the page-layer
 *  active row drops its face under the scrim. Marker writer =
 *  overlays/search-panel useSingleLitSurface. */
const SEARCH_OPEN_DIM =
  '[html[data-search-open]_&]:bg-transparent [html[data-search-open]_&]:shadow-none [html[data-search-open]_&]:ring-0 [html[data-search-open]_&]:text-content-secondary';

const ROW = `flex h-8 w-full flex-none items-center gap-2.5 rounded-(--cds-radius-lg) px-2.5 text-left text-ui text-content-secondary no-underline transition-[background-color,box-shadow,color] duration-150 ease-out ${FOCUS}`;
const ROW_IDLE = 'hover:bg-sidebar-hover hover:text-foreground [&>svg:first-child]:text-icon';
const ROW_ACTIVE = `bg-background font-medium text-foreground shadow-xs ring-1 ring-border [&>svg:first-child]:text-(--card-button) ${SEARCH_OPEN_DIM}`;

/** Ghost Button neutralizer for rows: the row recipe owns fill, radius and
 *  type; the primitive's hover fill, gap and press shift are zeroed. */
const ROW_BTN =
  'justify-start border-none font-normal dark:hover:bg-sidebar-hover active:not-aria-[haspopup]:translate-y-0';

const ICON_BTN = `size-7 flex-none cursor-pointer rounded-(--radius-control) border-none bg-transparent p-0 text-content-tertiary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover active:not-aria-[haspopup]:translate-y-0 ${FOCUS}`;

const RAIL_ROW = `rail-row relative flex size-8 flex-none items-center justify-center rounded-(--cds-radius-lg) text-content-tertiary no-underline transition-[background-color,box-shadow,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-foreground ${FOCUS}`;
const RAIL_ACTIVE = `bg-background text-(--card-button) shadow-xs ring-1 ring-border hover:bg-background hover:text-(--card-button) ${SEARCH_OPEN_DIM}`;
const RAIL_BTN =
  'cursor-pointer border-none bg-transparent p-0 dark:hover:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:text-content-tertiary aria-expanded:hover:bg-sidebar-hover aria-expanded:hover:text-foreground active:not-aria-[haspopup]:translate-y-0';

/** Module-level on purpose: nested in BoardSidebar it would get a new
 *  identity per render and React would remount the Popover subtree, whose
 *  close callback then snaps the controlled `open` back to false. */
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
  running = 0,
  machinesOnline = 0,
  onSearch,
  onNewTask,
  usageNav = false,
  selected = 'board',
  projects,
  projectCounts,
}: BoardSidebarProps) {
  const { t } = useI18n();
  const { user } = useLiveData();
  const { search, pathname } = useLocation();
  const plain = withColumnParam(search, null);
  const attentionSearch = withColumnParam(search, 'pending');
  const projectRows = useMemo(
    () => (projects ?? [CANON_PROJECT]).filter((row) => !isDeleted(row.id)),
    [projects],
  );
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
  const machineStatusId = useId();
  const attentionLabel = attention > 0 ? `${t('需要我处理')} ${attention}` : t('需要我处理');

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
      <aside className="board-sidebar board-sidebar--collapsed relative z-(--z-docked) flex w-10 flex-none flex-col items-center gap-px bg-(--surface-1) pt-2 pb-2">
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
            {...railLink({ pathname: '/app', search: plain }, selected === 'board', t('工作台'))}
          >
            <Columns3 className={ICON} strokeWidth={STROKE} />
          </Link>
          <Link
            {...railLink(
              { pathname: '/app', search: attentionSearch },
              selected === 'attention',
              attentionLabel,
            )}
          >
            <CircleAlert className={ICON} strokeWidth={STROKE} />
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
                  <ProjectAvatar name={row.name} tone={i} />
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

  const navLink = (to: { pathname: string; search: string }, active: boolean) => ({
    className: `sidebar-row ${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`,
    to,
    'aria-current': active ? ('page' as const) : undefined,
  });

  return (
    <aside className="board-sidebar relative z-(--z-docked) flex w-(--sidebar-w) flex-none flex-col overflow-hidden bg-(--surface-1) px-3 pt-3 pb-2.5">
      <div
        data-testid="team-row"
        className="sidebar-team-row flex h-10 flex-none items-center gap-0.5 text-foreground"
      >
        <Link
          className={`sidebar-team-name flex h-10 min-w-0 flex-1 items-center gap-2 rounded-(--cds-radius-lg) px-2 text-foreground no-underline transition-[background-color,box-shadow] duration-150 ease-out ${FOCUS} ${
            selected === 'team'
              ? `sidebar-team-row--active bg-background shadow-xs ring-1 ring-border ${SEARCH_OPEN_DIM}`
              : 'hover:bg-sidebar-hover'
          }`}
          to={{ pathname: '/app/team', search: plain }}
          aria-current={selected === 'team' ? 'page' : undefined}
        >
          <span
            data-testid="brand-mark"
            aria-hidden="true"
            className="sidebar-brand-mark block size-4 flex-none"
            style={{
              backgroundColor: 'currentColor',
              WebkitMask: 'url("/logo-mark.svg") center / 100% no-repeat',
              mask: 'url("/logo-mark.svg") center / 100% no-repeat',
            }}
          />
          <span className="truncate font-heading text-heading font-semibold">
            {BRAND.manifestName}
          </span>
          <ChevronDown
            aria-hidden
            className="size-3.5 flex-none text-content-tertiary"
            strokeWidth={STROKE}
          />
        </Link>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className={ICON_BTN}
                aria-label={t('搜索')}
                onClick={onSearch}
              >
                <Search className="size-3.5" strokeWidth={STROKE} />
              </Button>
            }
          />
          <TooltipContent side="bottom" sideOffset={6}>
            {t('搜索')} <Kbd>⌘K</Kbd>
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          className={`sidebar-team-collapse ${ICON_BTN}`}
          aria-label={t('收起侧边栏')}
          onClick={onToggle}
        >
          <PanelLeft className="size-3.5" strokeWidth={STROKE} />
        </Button>
      </div>

      <Button
        variant="ghost"
        className={`sidebar-new-task mt-2 mb-3 h-8.5 flex-none cursor-pointer justify-start gap-2 rounded-(--cds-radius-lg) border-none bg-background px-3 text-ui font-medium text-foreground shadow-xs ring-1 ring-border transition-[box-shadow] duration-150 ease-out hover:bg-background hover:text-foreground hover:shadow-sm hover:ring-input dark:hover:bg-background ${FOCUS}`}
        onClick={onNewTask}
      >
        <Plus className="size-4 flex-none text-(--card-button)" strokeWidth={STROKE} />
        <span className="truncate">{t('新任务')}</span>
        <Kbd className="sidebar-kbd ml-auto">C</Kbd>
      </Button>

      <nav
        ref={navRef}
        className={`flex min-h-0 flex-1 flex-col gap-px overflow-y-auto ${scrollFadeClassName()}`}
      >
        <Link {...navLink({ pathname: '/app', search: plain }, selected === 'board')}>
          <Columns3 className={ICON} strokeWidth={STROKE} />
          <span className="truncate">{t('工作台')}</span>
        </Link>
        <Link {...navLink({ pathname: '/app', search: attentionSearch }, selected === 'attention')}>
          <CircleAlert className={ICON} strokeWidth={STROKE} />
          <span className="truncate">{t('需要我处理')}</span>
          {attention > 0 && <AttentionBadge count={attention} />}
        </Link>
        <Link {...navLink({ pathname: '/app/schedules', search: plain }, selected === 'schedules')}>
          <Clock className={ICON} strokeWidth={STROKE} />
          <span className="truncate">{t('定时')}</span>
        </Link>

        <div
          data-testid="project-group"
          className="mt-4 mb-0.5 flex h-6 flex-none items-center pr-1 pl-2.5 text-caption font-medium text-content-tertiary"
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
            className={`ml-auto flex size-5 items-center justify-center rounded-(--radius-control) text-content-tertiary hover:bg-sidebar-hover hover:text-foreground ${FOCUS}`}
            to={{ pathname: '/app/project/new', search: plain }}
            aria-label={t('新建项目')}
          >
            <Plus className="size-3.5" strokeWidth={STROKE} />
          </Link>
        </div>
        {!groupCollapsed.project &&
          projectRows.map((row, i) => {
            const href = `/app/project/${row.id}`;
            const active = pathname === href;
            const count = projectCounts?.get(row.id) ?? 0;
            return (
              <Link
                key={row.id}
                data-testid="project-row"
                className={`sidebar-subrow group/row ${ROW} ${active ? ROW_ACTIVE : ROW_IDLE}`}
                to={{ pathname: href, search: plain }}
                aria-current={active ? 'page' : undefined}
              >
                <ProjectAvatar name={row.name} tone={i} />
                <span data-testid="project-name" className="min-w-0 flex-1 truncate">
                  {row.name}
                </span>
                {count > 0 && (
                  <span
                    data-testid="project-count"
                    className="flex-none text-caption tabular-nums text-content-tertiary group-hover/row:text-content-secondary"
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
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
              className={`sidebar-user mt-1 h-auto flex-none cursor-pointer justify-start gap-2.5 rounded-(--cds-radius-lg) border-none bg-transparent px-2.5 py-2 font-normal hover:bg-sidebar-hover dark:hover:bg-sidebar-hover aria-expanded:bg-sidebar-hover [&_img]:block [&_img]:size-6 [&_img]:rounded-full`}
              aria-label={user.displayName}
              aria-describedby={machineStatusId}
            >
              {userAvatar}
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="max-w-full truncate text-ui text-foreground">
                  {user.displayName}
                </span>
                <span
                  id={machineStatusId}
                  data-testid="machine-status"
                  className="flex max-w-full items-center gap-1.5 truncate text-caption font-normal text-content-tertiary"
                >
                  <span
                    aria-hidden
                    className={`size-1.5 flex-none rounded-full ${machinesOnline > 0 ? 'bg-running' : 'bg-content-dim'}`}
                  />
                  {t('{n} 台机器在线', { n: machinesOnline })} · {t('执行中 {n}', { n: running })}
                </span>
              </span>
              <EllipsisVertical
                className="size-3.5 flex-none text-content-tertiary"
                strokeWidth={STROKE}
              />
            </Button>
          }
        />
      </div>
    </aside>
  );
}
