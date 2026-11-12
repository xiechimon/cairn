import { cn } from 'cn';
import { ListTodo } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useGithubConnection, useProjects, useTodos } from '../api/hooks.js';
import { toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useOpenComposer } from '../board/open-composer.js';
import { relativeTime } from '../board/rel-time.js';
import { threadHrefFrom } from '../board/thread-copy.js';
import { EmptyState } from '../components/empty-state.js';
import { KeyedMenuContent, KeyedMenuRadioItem } from '../components/menu-keys.js';
import { SegmentedTabs } from '../components/segmented.js';
import { CARD_RADIUS_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { StatusGlyph } from '../components/status-glyph.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { Phase } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import {
  ArrowUpDown,
  ChevronDown,
  Funnel,
  Grid2x2,
  ListLines,
  Search,
  Settings,
} from '../icons/index.js';
import { PHASE_STATUS, PHASE_UI } from '../phase.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { GithubIssuesDialog } from './github-issues-dialog.js';
import { PageShell } from './shell.js';

export const PROJECT_TASKS_LAYOUT_STORAGE_KEY = 'cairn.projectTasksLayout';

type TasksLayout = 'list' | 'grid';
type TaskFilter = 'all' | 'active' | 'done';
type TaskSort = 'default' | 'recent' | 'title';

interface TaskRow {
  id: string;
  seqNum: number;
  title: string;
  phase: Phase;
  phaseAt: number;
}

function isSettled(phase: Phase): boolean {
  return phase === 'done' || phase === 'closed';
}

function TaskStatus({ phase }: { phase: Phase }) {
  const { t } = useI18n();
  const { glyph, ink } = PHASE_STATUS[phase];
  return (
    <span
      data-testid="task-status"
      className={cn(
        'flex flex-none items-center gap-1 text-meta whitespace-nowrap',
        PHASE_UI[phase].tone === 'confirm' ? ink : 'text-content-tertiary',
      )}
    >
      <StatusGlyph kind={glyph} className={cn('size-3.25', ink)} />
      {t(PHASE_UI[phase].chip)}
    </span>
  );
}

function TaskAvatar({ name, src }: { name?: string | null; src?: string | null }) {
  return (
    <span className="prj-task-avatar relative size-5 flex-none after:absolute after:-right-px after:-bottom-px after:size-1.75 after:rounded-full after:border-[1.5px] after:border-card after:bg-(--badge-idle) after:content-['']">
      <SeededAvatar className="size-5" name={name} src={src} fallback="/avatar-user.png" />
    </span>
  );
}

function readStoredLayout(storage: Storage | null): TasksLayout {
  try {
    return storage?.getItem(PROJECT_TASKS_LAYOUT_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function filterOk(phase: Phase, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'done') return phase === 'done';
  return phase !== 'done';
}

function sortTodos(rows: TaskRow[], sort: TaskSort): TaskRow[] {
  if (sort === 'recent') return [...rows].sort((a, b) => b.phaseAt - a.phaseAt);
  if (sort === 'title') return [...rows].sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  return rows;
}

const TASK_FILTERS: { id: TaskFilter; label: string; shortcut: string }[] = [
  { id: 'all', label: '全部', shortcut: 'A' },
  { id: 'active', label: '进行中', shortcut: 'P' },
  { id: 'done', label: '已完成', shortcut: 'D' },
];

const TASK_SORTS: { id: TaskSort; label: string; shortcut: string }[] = [
  { id: 'default', label: '默认', shortcut: 'D' },
  { id: 'recent', label: '最近更新', shortcut: 'R' },
  { id: 'title', label: '标题', shortcut: 'T' },
];

function TasksMenu<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { id: T; label: string; shortcut: string }[];
  value: T;
  onSelect: (id: T) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={(next) => onSelect(next as T)}>
      {options.map((option) => (
        <KeyedMenuRadioItem
          key={option.id}
          value={option.id}
          shortcut={option.shortcut}
          closeOnClick
        >
          {t(option.label)}
        </KeyedMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function TasksMenuButton<T extends string>({
  icon,
  label,
  options,
  value,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  options: { id: T; label: string; shortcut: string }[];
  value: T;
  onSelect: (id: T) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <span className="relative flex">
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          {icon}
          {t(label)}
          <ChevronDown width={12} height={12} />
        </DropdownMenuTrigger>
      </span>
      <KeyedMenuContent sideOffset={6} aria-label={t(label)} className="w-auto min-w-37">
        <TasksMenu options={options} value={value} onSelect={onSelect} />
      </KeyedMenuContent>
    </DropdownMenu>
  );
}

function TasksPane({
  todos,
  now,
  onNewTask,
  onOpenGithubIssues,
}: {
  todos: TaskRow[];
  now: number;
  onNewTask: () => void;
  onOpenGithubIssues?: () => void;
}) {
  const { t } = useI18n();
  const { user } = useLiveData();
  const { search } = useLocation();
  const [layout, setLayout] = useState<TasksLayout>(() => readStoredLayout(safeLocalStorage()));
  const switchLayout = useCallback((next: TasksLayout) => {
    setLayout(next);
    safeSetItem(PROJECT_TASKS_LAYOUT_STORAGE_KEY, next);
  }, []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [sort, setSort] = useState<TaskSort>('default');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = todos.filter(
      (todo) =>
        filterOk(todo.phase, filter) &&
        (needle === '' || todo.title.toLowerCase().includes(needle)),
    );
    return sortTodos(rows, sort);
  }, [todos, query, filter, sort]);
  return (
    <div className="pb-6">
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="text"
            placeholder={t('搜索任务…')}
            aria-label={t('搜索任务')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <TasksMenuButton
          icon={<Funnel />}
          label="筛选"
          options={TASK_FILTERS}
          value={filter}
          onSelect={setFilter}
        />
        <TasksMenuButton
          icon={<ArrowUpDown />}
          label="排序"
          options={TASK_SORTS}
          value={sort}
          onSelect={setSort}
        />
        {onOpenGithubIssues !== undefined && (
          <Button variant="outline" onClick={onOpenGithubIssues}>
            {t('从 GitHub issue 建任务')}
          </Button>
        )}
        <SegmentedTabs
          optionHandle="prj-tasks-view-btn"
          value={layout}
          onChange={switchLayout}
          options={[
            { value: 'list', ariaLabel: t('列表视图'), icon: <ListLines /> },
            { value: 'grid', ariaLabel: t('网格视图'), icon: <Grid2x2 /> },
          ]}
        />
      </div>
      {todos.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={ListTodo}
          title={t('暂无内容')}
          description={t('创建第一个任务以开始使用。')}
          action={{ label: t('新建任务'), onClick: onNewTask }}
        />
      ) : visible.length === 0 ? (
        <p className="m-0 mt-6 text-center text-ui text-content-tertiary">{t('没有匹配的任务')}</p>
      ) : layout === 'list' ? (
        <SettingsCard className="prj-task-list mt-4">
          {visible.map((todo) => (
            <div
              key={todo.id}
              data-testid="task-row"
              className={cn('prj-task-row relative', SETTINGS_ROW_CLS)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <Link
                  className={cn(
                    "prj-task-link truncate text-ui no-underline after:absolute after:inset-0 after:content-['']",
                    isSettled(todo.phase) ? 'text-content-secondary' : 'text-foreground',
                  )}
                  to={threadHrefFrom(todo.id, search)}
                >
                  {todo.title}
                </Link>
                <span data-testid="task-meta" className="truncate text-meta text-content-tertiary">
                  {relativeTime(todo.phaseAt, now, t)}
                </span>
              </span>
              <TaskStatus phase={todo.phase} />
              <TaskAvatar name={user.displayName} src={user.avatarUrl} />
            </div>
          ))}
        </SettingsCard>
      ) : (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(224px,1fr))] gap-2">
          {visible.map((todo) => (
            <Card
              key={todo.id}
              size="sm"
              data-testid="task-card"
              className={cn(
                'prj-task-card relative items-start gap-2 px-3.5 py-3 ring-border',
                CARD_RADIUS_CLS,
              )}
            >
              <div className="flex items-center justify-between self-stretch">
                <TaskStatus phase={todo.phase} />
                <TaskAvatar name={user.displayName} src={user.avatarUrl} />
              </div>
              <Link
                className={cn(
                  "prj-task-link line-clamp-2 text-card-title no-underline after:absolute after:inset-0 after:content-['']",
                  isSettled(todo.phase)
                    ? 'font-normal text-content-secondary'
                    : 'font-medium text-foreground',
                )}
                to={threadHrefFrom(todo.id, search)}
              >
                {todo.title}
              </Link>
              <span data-testid="task-meta" className="text-meta text-content-tertiary">
                {relativeTime(todo.phaseAt, now, t)}
              </span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectTasksPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const projectsQ = useProjects(teamId, live);
  const todosQ = useTodos(teamId, live);
  const wireProject = live ? (projectsQ.data ?? []).find((p) => p.id === id) : undefined;
  const isGithubRepoEntry = live && wireProject?.repoKind === 'github';
  const todos = live
    ? (todosQ.data ?? []).map(toDisplayTodo).filter((x) => x.projectId === id)
    : fixture.todos.filter((x) => x.projectId === id);
  const openComposer = useOpenComposer();
  const openNewTask = useCallback(() => openComposer(id), [openComposer, id]);
  const ghConnQ = useGithubConnection(isGithubRepoEntry ? teamId : undefined, isGithubRepoEntry);
  const ghIssuesAvailable = isGithubRepoEntry && ghConnQ.data?.connected === true;
  const [issuesOpen, setIssuesOpen] = useState(false);
  const closeIssues = useCallback(() => setIssuesOpen(false), []);
  const onIssueImported = useCallback(
    (record: { id: string }) => {
      setIssuesOpen(false);
      navigate(threadHrefFrom(record.id, search));
    },
    [navigate, search],
  );
  return (
    <PageShell
      route="project"
      fixture={live ? { ...fixture, todos } : fixture}
      selected="none"
      title={(live ? wireProject?.name : fixture.project?.name) ?? ''}
      actions={
        id === undefined ? undefined : (
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to={{ pathname: `/app/project/${id}/settings`, search }} />}
            aria-label={t('设置')}
          >
            <Settings />
          </Button>
        )
      }
    >
      <TasksPane
        todos={todos}
        now={live ? Date.now() : fixture.now}
        onNewTask={openNewTask}
        {...(ghIssuesAvailable ? { onOpenGithubIssues: () => setIssuesOpen(true) } : {})}
      />
      {ghIssuesAvailable && id !== undefined && (
        <GithubIssuesDialog
          open={issuesOpen}
          onClose={closeIssues}
          projectId={id}
          teamId={teamId}
          onImported={onIssueImported}
        />
      )}
    </PageShell>
  );
}
