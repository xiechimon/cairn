import { BRAND, type ProjectColor, type ProjectIcon } from '@cairn/shared';
import { cn } from 'cn';
import {
  Activity,
  Archive,
  ChartColumn,
  ChevronLeft,
  Monitor,
  PanelLeft,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Link, type To, useLocation, useNavigate } from 'react-router';
import { BrandGlyph } from '../components/brand-glyph.js';
import { SidebarNavRow } from '../components/shell/sidebar-nav-row.js';
import {
  ProjectGlyph,
  SIDEBAR_ROW_ACTION,
  SidebarProjectGroupHeader,
  SidebarProjectRow,
  type TreePlace,
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
import { DeleteArchivedProjectsConfirm } from '../overlay/delete-archived-projects-confirm.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { ACTIVITY_PATH } from '../search/activity-href.js';
import { SETTINGS_HREF } from '../settings/settings-href.js';
import { fleetSummary } from './fleet-status.js';
import { coordinatorSearch } from './open-composer.js';
import { isArchivedProject } from './project-archive.js';
import {
  ProjectFilterMenu,
  SidebarArchivedProjectMenu,
  SidebarGroupMenu,
  SidebarProjectMenu,
} from './sidebar-project-menu.js';
import {
  isProjectFilter,
  type ProjectFilter,
  type ProjectStatus,
  sidebarProjects,
} from './sidebar-projects.js';
import { THREAD_PARAM } from './thread-copy.js';
import { PANE_PARAM } from './work-panel.js';

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

export interface SidebarProjectActions {
  move: (id: string, group: string | null) => void;
  archive: (id: string) => void;
  unarchive: (id: string) => void;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => void;
  removeMany: (ids: readonly string[]) => Promise<void>;
  renameGroup: (from: string, to: string) => Promise<void>;
  ungroup: (group: string) => void;
}

const CANON_PROJECTS: readonly SidebarProject[] = [{ id: PROJECT_ID, name: PROJECT_NAME }];

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
  statuses?: ReadonlyMap<string, ProjectStatus>;
  actions?: SidebarProjectActions;
  projectsState?: 'loading' | 'error';
  onRetryProjects?: () => void;
}

export const GROUP_STORAGE_KEYS = {
  groups: 'cairn.sidebarGroupsCollapsed',
} as const;

export const PROJECT_FILTER_STORAGE_KEY = 'cairn.sidebarProjectFilter';

function readProjectFilter(storage: Storage | null): ProjectFilter {
  try {
    const stored = storage?.getItem(PROJECT_FILTER_STORAGE_KEY);
    return isProjectFilter(stored) ? stored : 'active';
  } catch {
    return 'active';
  }
}

const NOTHING_WAITING: ReadonlySet<string> = new Set();
const NO_STATUSES: ReadonlyMap<string, ProjectStatus> = new Map();

function readGroupsCollapsed(storage: Storage | null): ReadonlySet<string> {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(GROUP_STORAGE_KEYS.groups) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((name) => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

function treePlace(index: number, count: number): TreePlace {
  if (count === 1) return 'only';
  if (index === 0) return 'first';
  return index === count - 1 ? 'last' : 'middle';
}

const ICON = 'size-5 flex-none';
const STROKE = 1.75;

const FOCUS =
  'outline-none focus-visible:[outline:var(--focus-width)_solid_var(--focus-ring)] focus-visible:outline-offset-0';

const SIDEBAR_FOOT_ROW = `flex h-8.5 flex-none items-center justify-start gap-3 rounded-(--cds-radius-md) pr-2 pl-1.5 text-ui text-sidebar-ink no-underline hover:bg-sidebar-hover hover:text-foreground pointer-coarse:h-11 ${FOCUS}`;

const SEARCH_OPEN_DIM =
  '[html[data-search-open]_&]:bg-transparent [html[data-search-open]_&]:shadow-none [html[data-search-open]_&]:ring-0 [html[data-search-open]_&]:text-content-secondary';

const SEARCH_OPEN_DIM_CURRENT =
  '[html[data-search-open]_&_[aria-current=page]]:bg-transparent [html[data-search-open]_&_[aria-current=page]]:text-content-secondary';

const ICON_BTN = `size-7 flex-none cursor-pointer rounded-(--cds-radius-md) border-none bg-transparent p-0 text-sidebar-ink hover:bg-sidebar-hover hover:text-foreground dark:hover:bg-sidebar-hover active:bg-sidebar-hover dark:active:bg-sidebar-hover aria-expanded:bg-transparent ${FOCUS}`;

const RAIL_ROW = `rail-row relative flex size-8 flex-none items-center justify-center rounded-(--cds-radius-md) text-sidebar-ink no-underline transition-[background-color,color] duration-150 ease-out hover:bg-sidebar-hover hover:text-foreground ${FOCUS_RING_INSET}`;
const RAIL_ACTIVE = `bg-(--sidebar-active) text-foreground hover:bg-(--sidebar-active) hover:text-foreground ${SEARCH_OPEN_DIM}`;
const RAIL_BTN =
  'cursor-pointer border-none bg-transparent p-0 dark:hover:bg-sidebar-hover active:bg-sidebar-hover dark:active:bg-sidebar-hover aria-expanded:bg-transparent aria-expanded:text-sidebar-ink aria-expanded:hover:bg-sidebar-hover aria-expanded:hover:text-foreground';

function SidebarTip({
  label,
  hint,
  side = 'top',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  side?: 'top' | 'bottom' | 'right';
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} sideOffset={side === 'right' ? 8 : 6}>
        {label}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function DeleteAllButton({ count, onDelete }: { count: number; onDelete: () => void }) {
  const { t } = useI18n();
  const empty = count === 0;
  const button = (
    <Button
      variant="secondary"
      data-testid="sidebar-archived-delete-all"
      aria-disabled={empty || undefined}
      className={cn(
        'h-7 flex-none rounded-(--cds-radius-md) border-none px-2.5 text-caption font-normal text-foreground pointer-coarse:h-11',
        empty && 'cursor-not-allowed opacity-50',
      )}
      onClick={() => {
        if (!empty) onDelete();
      }}
    >
      {t('全部删除')}
    </Button>
  );
  return empty ? <SidebarTip label={t('没有可删除的已归档项目')}>{button}</SidebarTip> : button;
}

function FleetChip({
  tone,
  online,
  className,
}: {
  tone: 'online' | 'offline';
  online: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-slot="fleet-chip"
      className={cn(
        'relative grid size-6 flex-none place-items-center rounded-full bg-(--sidebar-press) text-foreground',
        className,
      )}
    >
      <Monitor className="size-4" strokeWidth={STROKE} />
      <span
        data-slot="fleet-badge"
        className={cn(
          'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-(--sidebar-surface)',
          online === 0
            ? cn(
                'rounded-full border bg-(--sidebar-surface)',
                tone === 'offline' ? 'border-destructive' : 'border-content-tertiary',
              )
            : tone === 'offline'
              ? 'bg-destructive'
              : 'bg-running',
        )}
      />
    </span>
  );
}

function FooterIcon({
  label,
  to,
  testId,
  children,
}: {
  label: string;
  to: To;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <SidebarTip label={label}>
      <Link
        to={to}
        aria-label={label}
        data-testid={testId}
        className={`grid size-7 flex-none place-items-center rounded-(--cds-radius-md) text-sidebar-ink hover:bg-sidebar-hover hover:text-foreground active:bg-(--sidebar-active) pointer-coarse:size-11 ${FOCUS}`}
      >
        {children}
      </Link>
    </SidebarTip>
  );
}

function RailTip({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: ReactNode;
  icon: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children}>{icon}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
        {hint}
      </TooltipContent>
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
  statuses = NO_STATUSES,
  actions,
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
  const projectHref = (id: string, chat = false) => {
    const next = new URLSearchParams(baseParams);
    next.set('project', id);
    if (chat) next.set('chat', '1');
    return { pathname: '/app', search: `?${next}` };
  };
  const plain = `?${baseParams}`;
  const machinesParams = new URLSearchParams(pathname === '/app' ? search : baseParams);
  machinesParams.delete(THREAD_PARAM);
  machinesParams.set(PANE_PARAM, 'machines');
  const machinesTarget = { pathname: '/app', search: `?${machinesParams}` };
  const newProjectTarget = { pathname: '/app/project/new', search: plain };
  const coordinatorTarget = { pathname: '/app', search: coordinatorSearch(search) };
  const allProjects = projects ?? CANON_PROJECTS;
  const [filter, setFilter] = useState(() => readProjectFilter(safeLocalStorage()));
  const chooseFilter = useCallback((next: ProjectFilter) => {
    setFilter(next);
    safeSetItem(PROJECT_FILTER_STORAGE_KEY, next);
  }, []);
  const present = useMemo(() => allProjects.filter((row) => !isDeleted(row.id)), [allProjects]);
  const layout = useMemo(() => sidebarProjects(present, filter), [present, filter]);
  const activeLayout = useMemo(() => sidebarProjects(present), [present]);
  const listed = useMemo(
    () => [...activeLayout.ungrouped, ...activeLayout.groups.flatMap((group) => group.projects)],
    [activeLayout],
  );
  const groupNames = useMemo(() => activeLayout.groups.map((group) => group.name), [activeLayout]);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const archivedPage = filter === 'archived';
  const archivedRows = useMemo(
    () => (archivedPage ? [...layout.ungrouped, ...layout.groups.flatMap((g) => g.projects)] : []),
    [archivedPage, layout],
  );
  const archivedIds = useMemo(
    () => present.filter(isArchivedProject).map((row) => row.id),
    [present],
  );
  const archivedCount = archivedIds.length;
  const activeProject = allProjects.some((row) => row.id === projectParam) ? projectParam : null;
  const waitingLabel = t('有任务在等你');
  const archivedLabel = t('已归档');
  const statusText = (id: string) => {
    const status = statuses.get(id);
    if (status === undefined) return waiting.has(id) ? waitingLabel : null;
    return status.kind === 'working'
      ? t('{n} 件进行中', { n: status.count })
      : `${t(status.word)} · ${t(status.what.key, status.what.params)}`;
  };
  const projectMenu = (row: SidebarProject) =>
    actions === undefined ? undefined : isArchivedProject(row) ? (
      <SidebarArchivedProjectMenu
        name={row.name}
        onUnarchive={() => actions.unarchive(row.id)}
        onDelete={() => actions.remove(row.id)}
      />
    ) : (
      <SidebarProjectMenu
        name={row.name}
        group={row.group ?? null}
        groups={groupNames}
        onMove={(group) => actions.move(row.id, group)}
        onArchive={() => actions.archive(row.id)}
        onRename={(name) => actions.rename(row.id, name)}
        onDelete={() => actions.remove(row.id)}
        onInstructions={() => {
          const next = new URLSearchParams(baseParams);
          next.set('tab', 'memory');
          navigate({ pathname: `/app/project/${row.id}/settings`, search: `?${next}` });
        }}
      />
    );
  const projectRows = (rows: readonly SidebarProject[], flat = false) =>
    rows.map((row, index) => (
      <SidebarProjectRow
        key={row.id}
        name={row.name}
        icon={row.icon}
        place={treePlace(index, rows.length)}
        flat={flat}
        waiting={waiting.has(row.id) ? waitingLabel : null}
        status={isArchivedProject(row) ? null : statusText(row.id)}
        archived={isArchivedProject(row) ? archivedLabel : null}
        active={activeProject === row.id}
        onClick={() => navigate(projectHref(row.id, isArchivedProject(row)))}
        menu={projectMenu(row)}
      />
    ));
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
  const navRef = useRef<HTMLElement | null>(null);
  useScrollFade(navRef, { enabled: !collapsed });
  const coordinatorActive = selected === 'board' && activeProject === null;

  const settingsTarget = { pathname: SETTINGS_HREF, search: plain };
  const activityTarget = { pathname: ACTIVITY_PATH, search: plain };
  const fleet = fleetSummary(
    { online: machinesOnline, offline: machinesOffline, offlineNames: offlineMachineNames },
    t,
  );
  const [fleetMain = ''] = (fleet?.label ?? '').split(' · ');

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
      <aside className="board-sidebar board-sidebar--collapsed relative z-(--z-docked) flex w-(--sidebar-rail-w) flex-none flex-col items-center bg-(--sidebar-surface) pb-2">
        <div className="mx-2 flex h-12 flex-none items-center justify-center self-stretch border-b border-border">
          <RailTip
            label={t('展开侧边栏')}
            icon={<PanelLeft className="size-5.5" strokeWidth={STROKE} />}
          >
            <Button
              variant="ghost"
              className={cn('rail-toggle', RAIL_ROW, RAIL_BTN, 'size-7 text-content-tertiary')}
              aria-label={t('展开侧边栏')}
              onClick={onToggle}
            />
          </RailTip>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto pt-1">
          <RailTip
            label={t('搜索')}
            hint={<Kbd>⌘K</Kbd>}
            icon={<Search className={ICON} strokeWidth={STROKE} />}
          >
            <Button
              variant="ghost"
              className={`${RAIL_ROW} ${RAIL_BTN}`}
              aria-label={t('搜索')}
              onClick={onSearch}
            />
          </RailTip>
          <span aria-hidden className="h-1 flex-none" />
          <RailTip label={t('Coordinator')} icon={<BrandGlyph className={ICON} />}>
            <Link {...railLink(coordinatorTarget, coordinatorActive, t('Coordinator'))} />
          </RailTip>
          {listed.map((row) => {
            const href = projectHref(row.id);
            const label = waiting.has(row.id)
              ? t('{name}：有任务在等你', { name: row.name })
              : row.name;
            return (
              <RailTip
                key={row.id}
                label={label}
                icon={
                  <>
                    <ProjectGlyph icon={row.icon} />
                    {waiting.has(row.id) && (
                      <span
                        data-slot="needs-you-dot"
                        className="absolute top-1 right-1 size-1.5 rounded-full bg-(--card-button)"
                      />
                    )}
                  </>
                }
              >
                <Link {...railLink(href, activeProject === row.id, label)} />
              </RailTip>
            );
          })}
          <RailTip label={t('新建项目')} icon={<Plus className={ICON} strokeWidth={STROKE} />}>
            <Link
              {...railLink(newProjectTarget, false, t('新建项目'))}
              data-slot="sidebar-new-project"
            />
          </RailTip>
        </nav>
        <div className="flex flex-none flex-col items-center gap-0.5 pt-2">
          {fleet != null && (
            <RailTip
              label={fleet.title}
              icon={<FleetChip tone={fleet.tone} online={machinesOnline} />}
            >
              <Link
                {...railLink(machinesTarget, false, fleet.title)}
                data-testid="sidebar-attention"
                data-fleet={fleet.tone}
              />
            </RailTip>
          )}
          <RailTip label={t('活动')} icon={<Activity className={ICON} strokeWidth={STROKE} />}>
            <Link {...railLink(activityTarget, false, t('活动'))} data-testid="sidebar-activity" />
          </RailTip>
          <RailTip label={t('设置')} icon={<Settings className={ICON} strokeWidth={STROKE} />}>
            <Link {...railLink(settingsTarget, false, t('设置'))} data-testid="sidebar-settings" />
          </RailTip>
        </div>
      </aside>
    );
  }

  const ungroupedSpaced = layout.ungrouped.length > 0 || projectsState !== undefined;

  return (
    <aside
      className={`board-sidebar relative z-(--z-docked) flex w-(--sidebar-w) flex-none flex-col overflow-hidden bg-(--sidebar-surface) ${SEARCH_OPEN_DIM_CURRENT}`}
    >
      <div
        data-testid="team-row"
        className="sidebar-team-row mx-2 flex h-12 flex-none items-center border-b border-border pl-0.5 text-foreground"
      >
        <SidebarTip label={t('收起侧边栏')} side="bottom">
          <Button
            variant="ghost"
            className={cn('sidebar-team-collapse', ICON_BTN, 'text-content-tertiary')}
            aria-label={t('收起侧边栏')}
            onClick={onToggle}
          >
            <PanelLeft className="size-5.5" strokeWidth={STROKE} />
          </Button>
        </SidebarTip>
        <span className="sidebar-team-name ml-0.75 min-w-0 flex-1 truncate voice-title text-brand text-foreground">
          {BRAND.manifestName}
        </span>
        <SidebarTip label={<Kbd>⌘K</Kbd>} side="bottom">
          <Button
            variant="ghost"
            className={`sidebar-search ${ICON_BTN}`}
            aria-label={t('搜索')}
            onClick={onSearch}
          >
            <Search className={ICON} strokeWidth={STROKE} />
          </Button>
        </SidebarTip>
      </div>

      <nav
        ref={navRef}
        className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-1 ${scrollFadeClassName()}`}
      >
        <SidebarNavRow
          icon={<BrandGlyph className="size-5" />}
          label={t('Coordinator')}
          active={coordinatorActive}
          onClick={() => navigate(coordinatorTarget)}
          actionsPinned={filter === 'all'}
          actions={
            archivedPage ? undefined : (
              <>
                <ProjectFilterMenu filter={filter} onFilter={chooseFilter} />
                <SidebarTip label={t('新建项目')}>
                  <Link
                    to={newProjectTarget}
                    aria-label={t('新建项目')}
                    className={`grid place-items-center ${SIDEBAR_ROW_ACTION} ${FOCUS}`}
                  >
                    <Plus strokeWidth={STROKE} />
                  </Link>
                </SidebarTip>
              </>
            )
          }
        />
        {archivedPage && projectsState === undefined && (
          <div data-testid="sidebar-archived-page" className="flex flex-none flex-col">
            <div className="mx-2 mt-3 border-t border-border pt-2.5">
              <div className="flex h-7 items-center justify-between">
                <h2 className="m-0 text-[calc(1.25rem*var(--type-scale))] leading-7 font-normal text-foreground">
                  {t('已归档的项目')}
                </h2>
                <ProjectFilterMenu
                  filter={filter}
                  onFilter={chooseFilter}
                  className="size-7 bg-transparent"
                />
              </div>
            </div>
            <div className="mx-2 mt-2.5 mb-2 flex items-center gap-2">
              <p
                data-testid="sidebar-archived-note"
                className="m-0 min-w-0 flex-1 text-caption text-content-tertiary"
              >
                {t('已归档的项目和它们的对话会一直保留，直到你删除。')}
              </p>
              {actions !== undefined && (
                <DeleteAllButton count={archivedCount} onDelete={() => setConfirmingAll(true)} />
              )}
            </div>
            {archivedCount === 0 && (
              <p
                data-testid="sidebar-archived-empty"
                className="m-0 flex-none py-1 pr-2 pl-3.5 text-meta text-content-secondary"
              >
                {t('没有已归档的项目')}
              </p>
            )}
            <div className="flex flex-col gap-0.5">{projectRows(archivedRows, true)}</div>
          </div>
        )}
        {projectsState === 'loading' && (
          <div
            data-testid="sidebar-projects-loading"
            aria-busy="true"
            className="ml-5.5 flex flex-col gap-1.5 py-1 pr-2 pl-2.5"
          >
            <span className="sr-only">{t('正在加载项目')}</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}
        {projectsState === 'error' && (
          <div
            data-testid="sidebar-projects-error"
            className="ml-5.5 flex items-center gap-2 py-1 pr-1 pl-2.5 text-meta text-content-secondary"
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
        {!archivedPage && projectRows(layout.ungrouped)}
        {!archivedPage &&
          layout.groups.map((group, index) => {
            const expanded = !groupsCollapsed.has(group.name);
            const previous = layout.groups[index - 1];
            const spaced =
              previous === undefined
                ? ungroupedSpaced
                : !groupsCollapsed.has(previous.name) && previous.projects.length > 0;
            const groupWaiting = group.projects.some((row) => waiting.has(row.id));
            return (
              <div key={group.name} className="flex flex-col gap-0.5">
                <SidebarProjectGroupHeader
                  name={group.name}
                  expanded={expanded}
                  count={group.projects.length}
                  waiting={groupWaiting ? waitingLabel : null}
                  spaced={spaced}
                  onToggle={() => toggleGroup(group.name)}
                  menu={
                    actions === undefined ? undefined : (
                      <SidebarGroupMenu
                        name={group.name}
                        onRename={(next) => actions.renameGroup(group.name, next)}
                        onUngroup={() => actions.ungroup(group.name)}
                      />
                    )
                  }
                />
                {expanded && projectRows(group.projects)}
              </div>
            );
          })}
      </nav>

      <div data-testid="sidebar-pinned" className="flex flex-none flex-col gap-0.5 px-2 pb-2">
        {archivedPage ? (
          <Button
            variant="ghost"
            data-slot="sidebar-filter-back"
            className={cn(SIDEBAR_FOOT_ROW, 'border-none font-normal dark:hover:bg-sidebar-hover')}
            onClick={() => chooseFilter('active')}
          >
            <ChevronLeft className={ICON} strokeWidth={STROKE} />
            {t('进行中')}
          </Button>
        ) : (
          <>
            <Link
              data-slot="sidebar-new-project"
              className={SIDEBAR_FOOT_ROW}
              to={newProjectTarget}
            >
              <Plus className={ICON} strokeWidth={STROKE} />
              {t('新建项目')}
            </Link>
            <Button
              variant="ghost"
              data-slot="sidebar-archived-entry"
              className={cn(
                SIDEBAR_FOOT_ROW,
                'border-none font-normal dark:hover:bg-sidebar-hover',
              )}
              onClick={() => chooseFilter('archived')}
            >
              <Archive className={ICON} strokeWidth={STROKE} />
              {archivedLabel}
            </Button>
          </>
        )}
      </div>

      <div
        data-testid="sidebar-footer"
        className="flex h-14 flex-none items-center gap-1 border-t border-border pr-2 pl-1"
      >
        {fleet == null ? (
          <span className="flex-1" />
        ) : (
          <Link
            data-testid="sidebar-attention"
            data-fleet={fleet.tone}
            to={machinesTarget}
            title={fleet.title}
            aria-label={fleet.title}
            className={`flex h-9.5 min-w-0 flex-1 items-center gap-2.5 rounded-(--cds-radius-lg) pr-2 pl-2 text-ui whitespace-nowrap text-foreground no-underline hover:bg-sidebar-hover active:bg-(--sidebar-active) pointer-coarse:h-11 ${FOCUS}`}
          >
            <FleetChip tone={fleet.tone} online={machinesOnline} />
            <span className="min-w-0 truncate">{fleetMain}</span>
          </Link>
        )}
        {usageNav && (
          <FooterIcon label={t('用量')} to={{ pathname: '/app/usage', search: plain }}>
            <ChartColumn className={ICON} strokeWidth={STROKE} />
          </FooterIcon>
        )}
        <div className="flex flex-none items-center gap-0.5">
          <FooterIcon label={t('活动')} testId="sidebar-activity" to={activityTarget}>
            <Activity className={ICON} strokeWidth={STROKE} />
          </FooterIcon>
          <FooterIcon label={t('设置')} testId="sidebar-settings" to={settingsTarget}>
            <Settings className={ICON} strokeWidth={STROKE} />
          </FooterIcon>
        </div>
      </div>
      {actions !== undefined && (
        <DeleteArchivedProjectsConfirm
          count={archivedCount}
          open={confirmingAll}
          onClose={() => setConfirmingAll(false)}
          onConfirm={() => {
            setConfirmingAll(false);
            void actions.removeMany(archivedIds);
          }}
        />
      )}
    </aside>
  );
}
