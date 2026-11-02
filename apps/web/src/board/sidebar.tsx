import { BRAND, type ProjectColor, type ProjectIcon } from '@cairn/shared';
import { ChevronDown, Clock, EllipsisVertical, PanelLeft, Plus, Search } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { SpiralMark } from '../chief/chief-fab-icon.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import { SidebarProjectRow } from '../components/shell/sidebar-project.js';
import { SidebarUser } from '../components/shell/sidebar-user.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { DEMO_MODE } from '../demo/demo-gate.js';
import { UserMenu } from '../detail/user-menu.js';
import { isDeleted } from '../fixtures/deletions.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { scrollFadeClassName, useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { FOCUS_RING_INSET } from '../lib/focus-ring.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { readStoredTheme } from '../theme.js';
import { withColumnParam } from './columns.js';
import { withoutBoardView } from './home.js';
import { needsYouThreads } from './needs-you.js';
import { ProjectAvatar } from './project-avatar.js';

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
  usageNav?: boolean;
  selected?: SidebarSelected;
  projects?: SidebarProject[];
  todos?: TodoRecord[];
}

export const GROUP_STORAGE_KEYS = {
  project: 'cairn.sidebarProjectsCollapsed',
} as const;

function readProjectsCollapsed(storage: Storage | null): boolean {
  try {
    return storage?.getItem(GROUP_STORAGE_KEYS.project) === '1';
  } catch {
    return false;
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

const ICON_BTN = `size-7 flex-none cursor-pointer rounded-(--radius-control) border-none bg-transparent p-0 text-content-tertiary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover active:not-aria-[haspopup]:translate-y-0 ${FOCUS}`;

const RAIL_ROW = `rail-row relative flex size-8 flex-none items-center justify-center rounded-(--cds-radius-lg) text-content-tertiary no-underline transition-[background-color,box-shadow,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-foreground ${FOCUS_RING_INSET}`;
const RAIL_ACTIVE = `bg-(--hover-1) text-(--card-button) hover:bg-(--hover-1) hover:text-(--card-button) ${SEARCH_OPEN_DIM}`;
const RAIL_BTN =
  'cursor-pointer border-none bg-transparent p-0 dark:hover:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:text-content-tertiary aria-expanded:hover:bg-sidebar-hover aria-expanded:hover:text-foreground active:not-aria-[haspopup]:translate-y-0';

function UserMenuPopover({
  open,
  onOpenChange,
  trigger,
  usageNav,
  machinesOnline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  usageNav: boolean;
  machinesOnline: number;
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
        <UserMenu
          floating
          theme={readStoredTheme(safeLocalStorage())}
          usageNav={usageNav}
          machinesOnline={machinesOnline}
        />
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
  usageNav = false,
  selected = 'board',
  projects,
  todos,
}: BoardSidebarProps) {
  const { t } = useI18n();
  const { user } = useLiveData();
  const navigate = useNavigate();
  const { search, pathname } = useLocation();
  const stripped = withoutBoardView(withColumnParam(search, null));
  const baseParams = new URLSearchParams(stripped.startsWith('?') ? stripped.slice(1) : stripped);
  const projectParam = pathname === '/app' ? baseParams.get('project') : null;
  baseParams.delete('project');
  const homeParams = new URLSearchParams(baseParams);
  if (DEMO_MODE) homeParams.set('view', 'home');
  const projectHref = (id: string) => {
    const next = new URLSearchParams(homeParams);
    next.set('project', id);
    return { pathname: '/app', search: `?${next}` };
  };
  const plain = `?${baseParams}`;
  const homeSearch = `?${homeParams}`;
  const projectRows = useMemo(
    () => (projects ?? [CANON_PROJECT]).filter((row) => !isDeleted(row.id)),
    [projects],
  );
  const activeProject = projectRows.some((row) => row.id === projectParam) ? projectParam : null;
  const waitingByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of needsYouThreads(todos ?? [])) {
      counts.set(todo.projectId, (counts.get(todo.projectId) ?? 0) + 1);
    }
    return counts;
  }, [todos]);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [projectsCollapsed, setProjectsCollapsed] = useState(() =>
    readProjectsCollapsed(safeLocalStorage()),
  );
  const toggleProjects = useCallback(() => {
    setProjectsCollapsed((prev) => {
      safeSetItem(GROUP_STORAGE_KEYS.project, prev ? '0' : '1');
      return !prev;
    });
  }, []);
  const navRef = useRef<HTMLElement | null>(null);
  useScrollFade(navRef, { enabled: !collapsed });
  const coordinatorLabel = attention > 0 ? `${t('Coordinator')} ${attention}` : t('Coordinator');
  const coordinatorActive =
    (selected === 'board' || selected === 'kanban') && activeProject === null;

  const goTo = (target: string) => navigate({ pathname: target, search: plain });

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
        <nav className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto">
          <Link
            {...railLink(
              { pathname: '/app', search: homeSearch },
              coordinatorActive,
              coordinatorLabel,
            )}
          >
            <SpiralMark busy={false} className={ICON} />
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
            className={`rail-group group mt-2 ${RAIL_ROW} ${RAIL_BTN} ${projectsCollapsed ? 'rail-group--collapsed' : ''}`}
            aria-label={t(projectsCollapsed ? '展开{label}' : '收起{label}', {
              label: t('项目'),
            })}
            aria-expanded={!projectsCollapsed}
            onClick={toggleProjects}
          >
            <ChevronDown
              className="size-3.5 transition-transform duration-150 group-[.rail-group--collapsed]:-rotate-90"
              strokeWidth={STROKE}
            />
          </Button>
          {!projectsCollapsed &&
            projectRows.map((row, i) => {
              const href = projectHref(row.id);
              return (
                <Link key={row.id} {...railLink(href, activeProject === row.id, row.name)}>
                  <ProjectAvatar name={row.name} tone={i} icon={row.icon} color={row.color} bare />
                </Link>
              );
            })}
        </nav>
        <UserMenuPopover
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          usageNav={usageNav}
          machinesOnline={machinesOnline}
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
        <span className="sidebar-team-name flex h-11 min-w-0 flex-1 items-center gap-2 px-2 text-foreground">
          <BrandMark className="size-5.5" />
          <span className="truncate font-heading text-page font-title">{BRAND.manifestName}</span>
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className={`sidebar-search ${ICON_BTN}`}
                aria-label={t('搜索')}
                onClick={onSearch}
              >
                <Search className="size-4" strokeWidth={STROKE} />
              </Button>
            }
          />
          <TooltipContent side="bottom" sideOffset={6}>
            <Kbd>⌘K</Kbd>
          </TooltipContent>
        </Tooltip>
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
        <div className="relative">
          <SidebarNavRow
            icon={<SpiralMark busy={false} className="size-4" />}
            label={t('Coordinator')}
            active={coordinatorActive}
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
              projectsCollapsed ? 'sidebar-group--collapsed' : ''
            }`}
            aria-expanded={!projectsCollapsed}
            onClick={toggleProjects}
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
        {!projectsCollapsed &&
          projectRows.map((row, i) => (
            <SidebarProjectRow
              key={row.id}
              name={row.name}
              tone={i}
              icon={row.icon}
              color={row.color}
              waiting={waitingByProject.get(row.id) ?? 0}
              active={activeProject === row.id}
              onClick={() => navigate(projectHref(row.id))}
            />
          ))}
      </nav>

      <div className="flex flex-none flex-col gap-px pt-2">
        <UserMenuPopover
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          usageNav={usageNav}
          machinesOnline={machinesOnline}
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
    </aside>
  );
}
