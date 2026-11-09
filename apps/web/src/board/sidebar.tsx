import { BRAND, type ProjectColor, type ProjectIcon } from '@cairn/shared';
import {
  Activity,
  ChartColumn,
  ChevronDown,
  PanelLeft,
  Plus,
  Search,
  Server,
  Settings,
} from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Link, type To, useLocation, useNavigate } from 'react-router';
import { BrandGlyph } from '../components/brand-glyph.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import {
  ProjectGlyph,
  SidebarProjectGroupHeader,
  SidebarProjectRow,
} from '../components/shell/sidebar-project.js';
import { Button } from '../components/ui/button.js';
import { Kbd } from '../components/ui/kbd.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { isDeleted } from '../fixtures/deletions.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import { scrollFadeClassName, useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { FOCUS_RING_INSET } from '../lib/focus-ring.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { ACTIVITY_PATH } from '../search/activity-href.js';
import { SETTINGS_HREF, settingsHref } from '../settings/settings-href.js';
import { fleetSummary } from './fleet-status.js';
import { coordinatorSearch } from './open-composer.js';
import { SidebarProjectMenu } from './sidebar-project-menu.js';
import { sidebarProjects } from './sidebar-projects.js';

export type SidebarSelected =
  | 'board'
  | 'schedules'
  | 'none'
  | '/app/resources/skills'
  | '/app/resources/mcp-servers'
  | '/app/resources/secrets'
  | '/app/resources/machines'
  | '/app/resources/providers'
  | '/app/resources/model-routing';

export interface SidebarProject {
  id: string;
  name: string;
  icon?: ProjectIcon | null | undefined;
  color?: ProjectColor | null | undefined;
  group?: string | null | undefined;
  archivedAt?: number | null | undefined;
}

const CANON_PROJECT: SidebarProject = { id: PROJECT_ID, name: PROJECT_NAME };

interface BoardSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  machinesOnline?: number;
  machinesOffline?: number;
  offlineMachineNames?: string[];
  onSearch?: () => void;
  usageNav?: boolean;
  selected?: SidebarSelected;
  projects?: SidebarProject[];
  waiting?: ReadonlySet<string>;
  onArchiveProject?: (id: string) => void;
  onMoveProject?: (id: string, group: string | null) => void;
  projectsState?: 'loading' | 'error';
  onRetryProjects?: () => void;
}

export const GROUP_STORAGE_KEYS = {
  project: 'cairn.sidebarProjectsCollapsed',
  groups: 'cairn.sidebarGroupsCollapsed',
} as const;

const NOTHING_WAITING: ReadonlySet<string> = new Set();

function readProjectsCollapsed(storage: Storage | null): boolean {
  try {
    return storage?.getItem(GROUP_STORAGE_KEYS.project) === '1';
  } catch {
    return false;
  }
}

function readGroupsCollapsed(storage: Storage | null): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(GROUP_STORAGE_KEYS.groups) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((name) => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

const ICON = 'size-4.5 flex-none';
const STROKE = 1.75;

const FOCUS =
  'outline-none focus-visible:[outline:var(--focus-width)_solid_var(--focus-ring)] focus-visible:outline-offset-0';

const SEARCH_OPEN_DIM =
  '[html[data-search-open]_&]:bg-transparent [html[data-search-open]_&]:shadow-none [html[data-search-open]_&]:ring-0 [html[data-search-open]_&]:text-content-secondary';

const SEARCH_OPEN_DIM_CURRENT =
  '[html[data-search-open]_&_[aria-current=page]]:bg-transparent [html[data-search-open]_&_[aria-current=page]]:text-content-secondary';

const ICON_BTN = `size-7 flex-none cursor-pointer rounded-(--radius-control) border-none bg-transparent p-0 text-content-tertiary hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover active:bg-sidebar-hover dark:active:bg-sidebar-hover ${FOCUS}`;

const RAIL_ROW = `rail-row relative flex size-8 flex-none items-center justify-center rounded-(--cds-radius-lg) text-content-tertiary no-underline transition-[background-color,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-foreground ${FOCUS_RING_INSET}`;
const RAIL_ACTIVE = `bg-(--hover-1) text-(--card-button) hover:bg-(--hover-1) hover:text-(--card-button) ${SEARCH_OPEN_DIM}`;
const RAIL_BTN =
  'cursor-pointer border-none bg-transparent p-0 dark:hover:bg-sidebar-hover active:bg-sidebar-hover dark:active:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:text-content-tertiary aria-expanded:hover:bg-sidebar-hover aria-expanded:hover:text-foreground';

function SidebarFooterIcon({
  label,
  to,
  state,
  testId,
  children,
}: {
  label: string;
  to: To;
  state?: unknown;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={to}
            state={state}
            aria-label={label}
            data-testid={testId}
            className={`grid size-8 place-items-center rounded-(--cds-radius-lg) text-content-tertiary hover:bg-sidebar-hover hover:text-foreground ${FOCUS}`}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function BoardSidebar({
  collapsed = false,
  onToggle,
  machinesOffline = 0,
  machinesOnline = 0,
  offlineMachineNames = [],
  onSearch,
  usageNav = false,
  selected = 'board',
  projects,
  waiting = NOTHING_WAITING,
  onArchiveProject,
  onMoveProject,
  projectsState,
  onRetryProjects,
}: BoardSidebarProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { search, pathname } = useLocation();
  const baseParams = new URLSearchParams(search);
  const projectParam = pathname === '/app' ? baseParams.get('project') : null;
  baseParams.delete('project');
  baseParams.delete('chat');
  const projectHref = (id: string) => {
    const next = new URLSearchParams(baseParams);
    next.set('project', id);
    return { pathname: '/app', search: `?${next}` };
  };
  const plain = `?${baseParams}`;
  const coordinatorTarget = { pathname: '/app', search: coordinatorSearch(search) };
  const layout = useMemo(
    () => sidebarProjects((projects ?? [CANON_PROJECT]).filter((row) => !isDeleted(row.id))),
    [projects],
  );
  const listed = useMemo(
    () => [...layout.ungrouped, ...layout.groups.flatMap((group) => group.projects)],
    [layout],
  );
  const groupNames = useMemo(() => layout.groups.map((group) => group.name), [layout]);
  const activeProject = (projects ?? [CANON_PROJECT]).some((row) => row.id === projectParam)
    ? projectParam
    : null;
  const waitingLabel = t('有任务在等你');
  const projectMenu = (row: SidebarProject) =>
    onArchiveProject === undefined || onMoveProject === undefined ? undefined : (
      <SidebarProjectMenu
        name={row.name}
        group={row.group ?? null}
        groups={groupNames}
        onMove={(group) => onMoveProject(row.id, group)}
        onArchive={() => onArchiveProject(row.id)}
      />
    );
  const projectRow = (row: SidebarProject, nested: boolean) => (
    <SidebarProjectRow
      key={row.id}
      name={row.name}
      icon={row.icon}
      nested={nested}
      waiting={waiting.has(row.id) ? waitingLabel : null}
      active={activeProject === row.id}
      onClick={() => navigate(projectHref(row.id))}
      menu={projectMenu(row)}
    />
  );
  const [groupsCollapsed, setGroupsCollapsed] = useState(() =>
    readGroupsCollapsed(safeLocalStorage()),
  );
  const toggleGroup = useCallback((name: string) => {
    setGroupsCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      safeSetItem(GROUP_STORAGE_KEYS.groups, JSON.stringify([...next]));
      return next;
    });
  }, []);

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
  const coordinatorActive = selected === 'board' && activeProject === null;

  const settingsLink = {
    to: { pathname: SETTINGS_HREF, search: plain },
  };
  const activityLink = {
    to: { pathname: ACTIVITY_PATH, search: plain },
  };
  const fleet = fleetSummary(
    { online: machinesOnline, offline: machinesOffline, offlineNames: offlineMachineNames },
    t,
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
        <nav className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-px overflow-y-auto">
          <Link {...railLink(coordinatorTarget, coordinatorActive, t('Coordinator'))}>
            <BrandGlyph className={ICON} />
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
            listed.map((row) => {
              const href = projectHref(row.id);
              return (
                <Link key={row.id} {...railLink(href, activeProject === row.id, row.name)}>
                  <ProjectGlyph name={row.name} icon={row.icon} />
                  {waiting.has(row.id) && (
                    <span
                      data-slot="needs-you-dot"
                      className="absolute top-1 right-1 size-1.5 rounded-full bg-(--card-button)"
                    />
                  )}
                </Link>
              );
            })}
        </nav>
        {fleet != null && (
          <Link
            {...railLink({ pathname: settingsHref('machines'), search: plain }, false, fleet.title)}
            data-testid="sidebar-attention"
            data-fleet={fleet.tone}
          >
            <Server className={ICON} strokeWidth={STROKE} />
            {fleet.tone === 'offline' && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive" />
            )}
          </Link>
        )}
        <Link {...railLink(settingsLink.to, false, t('设置'))} data-testid="sidebar-settings">
          <Settings className={ICON} strokeWidth={STROKE} />
        </Link>
        <Link {...railLink(activityLink.to, false, t('活动'))} data-testid="sidebar-activity">
          <Activity className={ICON} strokeWidth={STROKE} />
        </Link>
      </aside>
    );
  }

  return (
    <aside
      className={`board-sidebar relative z-(--z-docked) flex w-(--sidebar-w) flex-none flex-col overflow-hidden bg-(--surface-1) px-3 pt-3 pb-2.5 ${SEARCH_OPEN_DIM_CURRENT}`}
    >
      <div
        data-testid="team-row"
        className="sidebar-team-row flex h-11 flex-none items-center text-foreground"
      >
        <Button
          variant="ghost"
          className={`sidebar-team-collapse ${ICON_BTN}`}
          aria-label={t('收起侧边栏')}
          onClick={onToggle}
        >
          <PanelLeft className={ICON} strokeWidth={STROKE} />
        </Button>
        <span className="sidebar-team-name ml-1 min-w-0 flex-1 truncate voice-title text-brand text-foreground">
          {BRAND.manifestName}
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
      </div>

      <div className="mt-2 flex flex-none flex-col gap-px">
        <SidebarNavRow
          icon={<BrandGlyph className="size-4" />}
          label={t('Coordinator')}
          active={coordinatorActive}
          onClick={() => navigate(coordinatorTarget)}
        />
      </div>

      <nav
        ref={navRef}
        className={`-mx-1 mt-3 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 ${scrollFadeClassName()}`}
      >
        <div
          data-testid="project-group"
          className="mb-0.5 flex h-6 flex-none items-center pr-1 pl-2.5 text-caption font-medium text-content-tertiary"
        >
          <Button
            variant="ghost"
            className={`sidebar-group group h-6 cursor-pointer gap-1 rounded-(--radius-control) border-none bg-transparent px-0 text-caption font-medium text-content-tertiary hover:bg-transparent hover:text-content-secondary dark:hover:bg-transparent aria-expanded:bg-transparent ${FOCUS} ${
              projectsCollapsed ? 'sidebar-group--collapsed' : ''
            }`}
            aria-expanded={!projectsCollapsed}
            onClick={toggleProjects}
          >
            {t('项目')}
            <ChevronDown
              aria-hidden
              className="sidebar-group-chevron size-3.5 text-content-dim transition-transform duration-150 group-[.sidebar-group--collapsed]:-rotate-90"
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
        {!projectsCollapsed && projectsState === 'loading' && (
          <div
            data-testid="sidebar-projects-loading"
            aria-busy="true"
            className="flex flex-col gap-1.5 px-2.5 py-1"
          >
            <span className="sr-only">{t('正在加载项目')}</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}
        {!projectsCollapsed && projectsState === 'error' && (
          <div
            data-testid="sidebar-projects-error"
            className="flex items-center gap-2 px-2.5 py-1 text-meta text-content-secondary"
          >
            <span className="min-w-0 flex-1">{t('项目没能加载')}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-meta"
              onClick={onRetryProjects}
            >
              {t('重试')}
            </Button>
          </div>
        )}
        {!projectsCollapsed && (
          <>
            {layout.ungrouped.map((row) => projectRow(row, false))}
            {layout.groups.map((group) => {
              const expanded = !groupsCollapsed.has(group.name);
              return (
                <div key={group.name} className="flex flex-col gap-px">
                  <SidebarProjectGroupHeader
                    name={group.name}
                    expanded={expanded}
                    onToggle={() => toggleGroup(group.name)}
                  />
                  {expanded && group.projects.map((row) => projectRow(row, true))}
                </div>
              );
            })}
          </>
        )}
      </nav>

      <div
        data-testid="sidebar-footer"
        className="box-content flex h-8 flex-none items-center gap-0.5 pt-2"
      >
        <SidebarFooterIcon label={t('设置')} testId="sidebar-settings" {...settingsLink}>
          <Settings className={ICON} strokeWidth={STROKE} />
        </SidebarFooterIcon>
        <SidebarFooterIcon label={t('活动')} testId="sidebar-activity" {...activityLink}>
          <Activity className={ICON} strokeWidth={STROKE} />
        </SidebarFooterIcon>
        {usageNav && (
          <SidebarFooterIcon label={t('用量')} to={{ pathname: '/app/usage', search: plain }}>
            <ChartColumn className={ICON} strokeWidth={STROKE} />
          </SidebarFooterIcon>
        )}
        {fleet != null && (
          <div className="@container flex min-w-0 flex-1 justify-end">
            <Link
              data-testid="sidebar-attention"
              data-fleet={fleet.tone}
              to={{ pathname: settingsHref('machines'), search: plain }}
              title={fleet.title}
              aria-label={fleet.title}
              className={`flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-caption whitespace-nowrap text-content-tertiary no-underline hover:text-content-secondary ${FOCUS}`}
            >
              <span
                aria-hidden
                className={`size-1.5 flex-none rounded-full ${fleet.tone === 'offline' ? 'bg-destructive' : 'bg-content-tertiary'}`}
              />
              <span className="@min-[9rem]:hidden">{fleet.short}</span>
              <span className="hidden @min-[9rem]:inline">{fleet.label}</span>
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
