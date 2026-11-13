import { parseSearchQuery, type SearchResponse } from '@cairn/shared';
import { Activity, CircleHelp, TriangleAlert } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useProjects } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { threadHrefFrom } from '../board/thread-copy.js';
import type { QueryLike } from '../components/query-state.js';
import { ShortcutHint } from '../components/shortcut-hint.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_FACE, DialogShell, VIEWPORT_POP_ANIM } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { withoutDeleted } from '../fixtures/deletions.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { FixtureSet, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Clock, Kanban, Search, Settings, X } from '../icons/index.js';
import { PHASE_STATUS, PHASE_UI } from '../phase.js';
import { ACTIVITY_PATH, activityHref } from '../search/activity-href.js';
import { activityTodosForHits, searchTodosLocally } from '../search/activity-model.js';
import { ChipProblems, QueryChip, SyntaxHelp } from '../search/query-chip.js';
import {
  chipProblem,
  completeTrailingToken,
  endsInFilter,
  joinQuery,
  removeChipAt,
  splitQuery,
} from '../search/search-query.js';
import { SETTINGS_HREF } from '../settings/settings-href.js';

const NAV_ROWS = [
  { label: 'Coordinator', Icon: Kanban, href: '/app' },
  { label: '定时', Icon: Clock, href: '/app/schedules' },
  { label: '活动', Icon: Activity, href: ACTIVITY_PATH },
  { label: '设置', Icon: Settings, href: SETTINGS_HREF },
];

export const ROW_BASE =
  'flex h-8 w-full cursor-pointer items-center justify-start gap-2.5 rounded-(--radius-menu-item) border-none bg-transparent px-2.5 text-left text-ui font-normal text-foreground hover:text-foreground [&>svg]:flex-none [&>svg:not([data-glyph])]:text-content-tertiary';

export const ROW_LIT = 'bg-(--menu-hover) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

function rowLitClasses(selected: boolean, kbd: boolean): string {
  if (selected) return ROW_LIT;
  if (kbd) return 'hover:bg-transparent dark:hover:bg-transparent';
  return 'hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';
}

export const GROUP_LABEL = 'px-2.5 pt-2 pb-1 text-caption font-medium text-content-tertiary';
export const ROW_END =
  'ml-auto flex flex-none items-center gap-1.5 pl-3 text-meta text-content-tertiary';

export interface SearchCommand {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

export interface SearchContext {
  seqNum: number;
  title: string;
  commands: SearchCommand[];
}

interface SearchPanelProps {
  fixture: FixtureSet;
  query: string;
  onQuery: (query: string) => void;
  open: boolean;
  onClose: () => void;
  server?: SearchResponse;
  serverQuery?: Pick<QueryLike, 'isError' | 'isFetching' | 'refetch'>;
  context?: SearchContext;
}

interface TodoRowItem {
  id: string;
  seqNum: number;
  title: string;
  phase: TodoRecord['phase'];
  phaseAt: number;
  projectId?: string;
  projectName?: string;
}
interface ProjectRowItem {
  id: string;
  name: string;
}

function TodoRow({
  todo,
  selected,
  kbd,
  index,
  onActivate,
  projectName,
}: {
  todo: TodoRowItem;
  selected: boolean;
  kbd: boolean;
  index: number;
  onActivate: () => void;
  projectName?: string;
}) {
  const projectMark = useProjectMark();
  const { t } = useI18n();
  const { glyph, ink } = PHASE_STATUS[todo.phase];
  return (
    <Button
      variant="ghost"
      data-row-kind="todo"
      data-row-index={index}
      data-selected={selected ? '' : undefined}
      onClick={onActivate}
      className={`${ROW_BASE} ${rowLitClasses(selected, kbd)}`}
    >
      <StatusGlyph kind={glyph} label={t(PHASE_UI[todo.phase].chip)} className={ink} />
      <span className="min-w-0 truncate">{todo.title}</span>
      <span className={ROW_END}>
        {projectName !== undefined && (
          <>
            <ProjectAvatar name={projectName} {...projectMark(projectName)} bare />
            <span className="max-w-32 truncate">{projectName}</span>
          </>
        )}
      </span>
    </Button>
  );
}

let openPanelCount = 0;
function useSingleLitSurface(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openPanelCount += 1;
    document.documentElement.dataset.searchOpen = '';
    return () => {
      openPanelCount -= 1;
      if (openPanelCount === 0) delete document.documentElement.dataset.searchOpen;
    };
  }, [open]);
}

export function SearchPanel({
  fixture,
  query,
  onQuery,
  open,
  onClose,
  server,
  serverQuery,
  context,
}: SearchPanelProps) {
  const projectMark = useProjectMark();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { search } = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const [cursor, setCursor] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (node && openRef.current) node.focus({ preventScroll: true });
  }, []);
  useSingleLitSurface(open);
  const q = query.trim().toLowerCase();
  const { chips, text } = splitQuery(query, Date.now());
  const hasFilters = parseSearchQuery(query, Date.now()).filters.length > 0;
  const useServer = server !== undefined && q !== '';
  const localSearch =
    !useServer && hasFilters
      ? searchTodosLocally(
          fixture.todos,
          (projectId) => fixture.projectNames?.[projectId] ?? PROJECT_NAME,
          parseSearchQuery(query, Date.now()),
        )
      : undefined;
  const todos: TodoRowItem[] = useServer
    ? server.todos
    : localSearch !== undefined
      ? localSearch.todos
      : q === ''
        ? []
        : fixture.todos.filter((t) => t.title.toLowerCase().includes(q));
  const chipProblems = chips.map((chip) =>
    chipProblem(chip, useServer ? server.filters : localSearch?.filters),
  );
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const liveProjects = live ? (projectsQ.data ?? []) : undefined;
  const projectName = fixture.projectNames
    ? (Object.values(fixture.projectNames)[0] ?? PROJECT_NAME)
    : PROJECT_NAME;
  const clientProjectName = (projectId: string | undefined): string | undefined =>
    liveProjects
      ? liveProjects.find((project) => project.id === projectId)?.name
      : ((projectId !== undefined ? fixture.projectNames?.[projectId] : undefined) ?? projectName);
  const projects: ProjectRowItem[] = useServer
    ? server.projects
    : q === '' || hasFilters
      ? []
      : liveProjects
        ? liveProjects
            .filter((project) => project.name.toLowerCase().includes(q))
            .map(({ id, name }) => ({ id, name }))
        : projectName.toLowerCase().includes(q)
          ? [
              {
                id: fixture.projectNames
                  ? (Object.keys(fixture.projectNames)[0] ?? PROJECT_ID)
                  : PROJECT_ID,
                name: projectName,
              },
            ]
          : [];
  const [contextOn, setContextOn] = useState(true);
  useEffect(() => {
    if (open) setContextOn(true);
  }, [open]);
  const activeContext = contextOn ? context : undefined;
  const dropContext = () => {
    setContextOn(false);
    setCursor(null);
  };
  const commands =
    activeContext?.commands.filter(
      (command) => q === '' || command.label.toLowerCase().includes(q),
    ) ?? [];
  const hitCount = commands.length + todos.length + projects.length;

  const go = (pathname: string) => {
    navigate({ pathname, search });
    onClose();
  };
  const openActivity = () => {
    navigate(activityHref(query, search));
    onClose();
  };
  const viewAllCount = activityTodosForHits(
    todos,
    live ? fixture.todos : withoutDeleted(fixture.todos),
  ).length;
  const showViewAll = q !== '' && viewAllCount > 0;
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (!open) setHelpOpen(false);
  }, [open]);
  const goThread = (id: string) => {
    navigate(threadHrefFrom(id, search));
    onClose();
  };
  const runCommand = (command: SearchCommand) => {
    onClose();
    command.run();
  };
  const actions: Array<() => void> = [
    ...commands.map((command) => () => runCommand(command)),
    ...(q === ''
      ? NAV_ROWS.map((row) => () => go(row.href))
      : [
          ...todos.map((todo) => () => goThread(todo.id)),
          ...projects.map((project) => () => go(`/app/project/${project.id}`)),
          ...(showViewAll ? [openActivity] : []),
        ]),
  ];
  const base = commands.length;
  const releaseCursor = () => setCursor(null);

  useEffect(() => {
    setCursor(null);
  }, [query, open]);

  useEffect(() => {
    if (cursor == null) return;
    listRef.current
      ?.querySelector(`[data-row-index="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const kbd = cursor != null;
  const searchFailed = q !== '' && serverQuery?.isError === true;

  return (
    <DialogShell
      open={open}
      onClose={onClose}
      viewportRoot
      backdropClassName="z-(--z-modal-scrim) duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      zIndex="var(--z-modal)"
    >
      <div
        className={`search-panel fixed top-36.5 left-1/2 z-(--z-modal) flex max-h-110 w-160 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden ${DIALOG_FACE} origin-top transition-[opacity,scale] group-data-closed/dlgvp:scale-[0.98] group-data-closed/dlgvp:opacity-0 motion-reduce:transition-none ${VIEWPORT_POP_ANIM}`}
        role="dialog"
        aria-label={t('搜索')}
        onMouseEnter={releaseCursor}
        onMouseMove={(event) => {
          const prev = pointerRef.current;
          pointerRef.current = { x: event.clientX, y: event.clientY };
          if (prev != null && (prev.x !== event.clientX || prev.y !== event.clientY))
            setCursor(null);
        }}
      >
        {activeContext != null && (
          <div className="flex flex-none px-3.5 pt-3" data-testid="search-context">
            <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-(--cds-radius-md) bg-secondary pr-1 pl-2 text-meta text-content-secondary">
              <span className="truncate">{activeContext.title}</span>
              <button
                type="button"
                aria-label={t('移除上下文')}
                className="flex size-4.5 flex-none items-center justify-center rounded-sm text-content-tertiary hover:bg-(--menu-hover) hover:text-foreground"
                onClick={dropContext}
              >
                <X width={12} height={12} />
              </button>
            </span>
          </div>
        )}
        <div className="flex min-h-12 flex-none flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 text-content-tertiary">
          <Search width={20} height={20} className="flex-none" />
          {chips.map((chip, index) => (
            <QueryChip
              key={`${chip.raw}-${index}`}
              chip={chip}
              problem={chipProblems[index] ?? null}
              onRemove={() => {
                onQuery(joinQuery(removeChipAt(chips, index), text));
                inputRef.current?.focus({ preventScroll: true });
              }}
            />
          ))}
          <Input
            ref={attachInput}
            className="flex-1 min-w-24 h-auto border-none shadow-none ring-0 p-0 text-card-title md:text-card-title leading-5 rounded-none bg-transparent dark:bg-transparent text-foreground placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:!ring-0 focus-visible:outline-none"
            value={text}
            aria-label={t('搜索')}
            placeholder={t(
              activeContext != null
                ? '输入命令或搜索…'
                : chips.length > 0
                  ? '再加一个筛选或词'
                  : '搜索任务、项目…',
            )}
            onChange={(event) => onQuery(joinQuery(chips, event.target.value))}
            onKeyDown={(event) => {
              const lastChip = chips.at(-1);
              if (event.key === 'Backspace' && text === '' && lastChip !== undefined) {
                event.preventDefault();
                onQuery(joinQuery(chips.slice(0, -1), lastChip.raw));
              } else if (event.key === 'Backspace' && query === '' && activeContext != null) {
                event.preventDefault();
                dropContext();
              } else if (event.key === 'Tab' && !event.shiftKey) {
                const completed = completeTrailingToken(text);
                if (completed === null) return;
                event.preventDefault();
                onQuery(joinQuery(chips, completed));
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                openActivity();
              } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (actions.length === 0) return;
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setCursor((prev) =>
                  prev == null
                    ? event.key === 'ArrowDown'
                      ? 0
                      : actions.length - 1
                    : (prev + step + actions.length) % actions.length,
                );
              } else if (
                event.key === 'Enter' &&
                cursor == null &&
                endsInFilter(text, Date.now())
              ) {
                event.preventDefault();
                onQuery(`${query} `);
              } else if (event.key === 'Enter' && cursor != null) {
                const action = actions[cursor];
                if (action == null) return;
                event.preventDefault();
                action();
              }
            }}
          />
        </div>
        <ChipProblems chips={chips} problems={chipProblems} />
        {searchFailed && (
          <div
            role="alert"
            data-testid="search-error"
            className="flex flex-none items-center gap-3 border-b border-border px-4 py-2.5 text-ui text-content-secondary"
          >
            <TriangleAlert aria-hidden="true" className="size-5 flex-none text-destructive" />
            <span className="min-w-0 flex-1">{t('搜索没能完成，下面只是本地匹配的结果。')}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={serverQuery?.isFetching}
              onClick={() => void serverQuery?.refetch()}
            >
              {t('重试')}
            </Button>
          </div>
        )}
        {q !== '' && hitCount === 0 && !searchFailed ? (
          <div className="flex flex-col gap-2 px-4 py-6 text-ui text-content-tertiary">
            <span>
              {chips.length > 0
                ? t('没有同时满足这些筛选的任务')
                : t('没有与“{q}”匹配的结果', { q: query.trim() })}
            </span>
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-content-secondary"
                  onClick={() => onQuery(text)}
                >
                  {t('清除全部筛选')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-12 flex-1 overflow-y-auto px-1.5 pt-1 pb-1.5" ref={listRef}>
            {commands.length > 0 && (
              <>
                <div className={GROUP_LABEL}>{t('这个任务')}</div>
                {commands.map((command, index) => (
                  <Button
                    variant="ghost"
                    key={command.id}
                    data-row-kind="command"
                    data-row-index={index}
                    data-selected={cursor === index ? '' : undefined}
                    className={`${ROW_BASE} ${rowLitClasses(cursor === index, kbd)}`}
                    onClick={() => runCommand(command)}
                  >
                    {command.icon}
                    {command.label}
                  </Button>
                ))}
              </>
            )}
            {q === '' ? (
              <>
                <div className={GROUP_LABEL}>{t('前往')}</div>
                {NAV_ROWS.map(({ label, Icon, href }, index) => (
                  <Button
                    variant="ghost"
                    key={label}
                    data-row-kind="nav"
                    data-row-index={base + index}
                    data-selected={cursor === base + index ? '' : undefined}
                    className={`${ROW_BASE} ${rowLitClasses(cursor === base + index, kbd)}`}
                    onClick={() => go(href)}
                  >
                    <Icon width={15} height={15} />
                    {t(label)}
                  </Button>
                ))}
              </>
            ) : (
              <>
                {todos.length > 0 && (
                  <>
                    <div className={GROUP_LABEL}>{t('任务')}</div>
                    {todos.map((todo, index) => (
                      <TodoRow
                        key={todo.id}
                        todo={todo}
                        selected={cursor === base + index}
                        kbd={kbd}
                        index={base + index}
                        onActivate={() => goThread(todo.id)}
                        projectName={
                          useServer ? todo.projectName : clientProjectName(todo.projectId)
                        }
                      />
                    ))}
                  </>
                )}
                {projects.length > 0 && (
                  <>
                    <div className={GROUP_LABEL}>{t('项目')}</div>
                    {projects.map((project, index) => {
                      const rowIndex = base + todos.length + index;
                      return (
                        <Button
                          variant="ghost"
                          key={project.id}
                          data-row-kind="project"
                          data-row-index={rowIndex}
                          data-selected={cursor === rowIndex ? '' : undefined}
                          className={`${ROW_BASE} ${rowLitClasses(cursor === rowIndex, kbd)}`}
                          onClick={() => go(`/app/project/${project.id}`)}
                        >
                          <ProjectAvatar name={project.name} {...projectMark(project.id)} bare />
                          <span className="truncate">{project.name}</span>
                        </Button>
                      );
                    })}
                  </>
                )}
                {showViewAll && (
                  <>
                    <div className={GROUP_LABEL}>{t('没找到想要的？')}</div>
                    <Button
                      variant="ghost"
                      data-row-kind="activity"
                      data-row-index={base + todos.length + projects.length}
                      data-selected={
                        cursor === base + todos.length + projects.length ? '' : undefined
                      }
                      className={`${ROW_BASE} ${rowLitClasses(cursor === base + todos.length + projects.length, kbd)}`}
                      onClick={openActivity}
                    >
                      <Activity width={18} height={18} />
                      {t('在活动里查看全部 {n} 条', { n: viewAllCount })}
                      <span className={ROW_END}>
                        <ShortcutHint keys={['mod', 'enter']} />
                      </span>
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {helpOpen && (
          <SyntaxHelp
            onClose={() => setHelpOpen(false)}
            className="mx-1.5 mb-1.5 max-h-64 min-h-24 shrink overflow-y-auto shadow-none ring-1 ring-border"
          />
        )}
        <div className="flex h-9 flex-none items-center gap-4 border-t border-border px-3.5 text-caption text-content-tertiary">
          <span className="flex items-center gap-1.5">
            <ShortcutHint keys={['up', 'down']} />
            {t('移动')}
          </span>
          <span className="flex items-center gap-1.5">
            <ShortcutHint keys={['enter']} />
            {t('打开')}
          </span>
          {activeContext != null && (
            <span className="flex items-center gap-1.5">
              <ShortcutHint keys={['backspace']} />
              {t('移除上下文')}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              className="text-content-tertiary"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((value) => !value)}
            >
              <CircleHelp data-icon="inline-start" />
              {t('语法')}
            </Button>
            <ShortcutHint keys={['Esc']} />
            {t('关闭')}
          </span>
        </div>
      </div>
    </DialogShell>
  );
}

export function useSearchState(initialOpen: boolean, initialQuery: string) {
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState(initialQuery);
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen, query, setQuery };
}
