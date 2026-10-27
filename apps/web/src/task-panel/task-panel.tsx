import { cn } from 'cn';
import {
  ArrowUp,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  Maximize2,
  PanelRight,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useLocation } from 'react-router';
import { useApiMutations, useMessages, useProjects, useSteps, useTodos } from '../api/hooks.js';
import { textOfContent, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import {
  attentionCount,
  COLUMNS,
  cardFace,
  sortColumnTodos,
  splitStale,
} from '../board/columns.js';
import { relativeTime } from '../board/rel-time.js';
import { ATTENTION } from '../board/todo-card.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Textarea } from '../components/ui/textarea.js';
import { TodoStatus } from '../detail/segments.js';
import { useDetailComposer } from '../detail/use-detail-composer.js';
import { PROJECT_NAME } from '../fixtures/fixtures.js';
import type { FixtureSet, Phase, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_UI } from '../phase.js';
import { STAGES, type StageState, stagesFor } from './stages.js';
import { type TaskPanelApi, useTaskPanel } from './task-panel-root.js';

const GROUPS = [
  { column: 'pending', name: '待你处理', empty: '需要你回答、确认或检查的任务会出现在这里。' },
  { column: 'building', name: '运行中', empty: '没有运行中的任务' },
  { column: 'todo', name: '待开始', empty: '没有待开始的任务' },
  { column: 'done', name: '已完成', empty: '还没有已完成的任务' },
] as const;

const ASK_HINT = {
  failed: '运行失败。可以在下方说明后重跑，或展开查看过程。',
  confirm: '方案已写好，确认后开始执行。',
  review: '改动已完成，审阅后合并。',
  reply: 'Agent 在等你的回复。',
} as const;

const NEEDS_YOU_INK = 'text-(--card-button)';
const OPEN_SURFACE =
  '.overlay, [role="dialog"]:not(.chief-drawer), [role="menu"], [role="listbox"]';
const FLASH_MS = 1400;
const HEAD_CONTROL = 'button, a';

interface TaskView {
  id: string;
  title: string | null;
  seq: number | null;
  phase: Phase | null;
  todo: TodoRecord | null;
}

export function TaskPanelToggle() {
  const { t } = useI18n();
  const panel = useTaskPanel();
  if (panel == null || !panel.hosted) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative text-content-tertiary"
      aria-label={t('任务面板')}
      aria-expanded={panel.open}
      onClick={(event) => {
        if (panel.open) panel.close();
        else panel.showList({ opener: event.currentTarget, focus: event.detail === 0 });
      }}
    >
      <PanelRight aria-hidden strokeWidth={1.75} className="size-4" />
      {panel.needCount > 0 && !panel.open && (
        <span
          data-testid="task-panel-need-dot"
          aria-hidden
          className="absolute top-1 right-1 size-1.5 rounded-full bg-(--card-button)"
        />
      )}
    </Button>
  );
}

export function TaskPanel({ fixture }: { fixture: FixtureSet }) {
  const panel = useTaskPanel();
  const { live, teamId } = useLiveData();
  const todosQ = useTodos(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const todos = useMemo(
    () => (live ? (todosQ.data ?? []).map(toDisplayTodo) : fixture.todos),
    [live, todosQ.data, fixture.todos],
  );
  const projectNames = useMemo(
    () =>
      live
        ? Object.fromEntries((projectsQ.data ?? []).map((p) => [p.id, p.name]))
        : fixture.projectNames,
    [live, projectsQ.data, fixture.projectNames],
  );
  const ready = !live || todosQ.isSuccess;
  const now = live ? Date.now() : fixture.now;

  const seen = useRef<Set<string> | null>(null);
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!ready) return;
    if (seen.current == null) {
      seen.current = new Set(todos.map((todo) => todo.id));
      return;
    }
    const known = seen.current;
    const fresh = todos.filter((todo) => !known.has(todo.id)).map((todo) => todo.id);
    for (const id of fresh) known.add(id);
    if (fresh.length > 0) setFlash(new Set(fresh));
  }, [todos, ready]);
  useEffect(() => {
    if (flash.size === 0) return;
    const timer = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);
  const register = panel?.registerHost;
  const setNeedCount = panel?.setNeedCount;
  const needCount = attentionCount(todos, now);

  useEffect(() => register?.(), [register]);
  useEffect(() => setNeedCount?.(needCount), [setNeedCount, needCount]);

  if (panel == null || !panel.open) return null;
  return (
    <OpenPanel
      panel={panel}
      todos={todos}
      ready={ready}
      now={now}
      projectOf={(todo) => projectNames?.[todo.projectId] ?? (live ? undefined : PROJECT_NAME)}
      flash={flash}
    />
  );
}

function OpenPanel({
  panel,
  todos,
  ready,
  now,
  projectOf,
  flash,
}: {
  panel: TaskPanelApi;
  todos: TodoRecord[];
  ready: boolean;
  now: number;
  projectOf: (todo: TodoRecord) => string | undefined;
  flash: ReadonlySet<string>;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement | null>(null);
  const { close, wantsFocus, focusTaken, taskId, seed } = panel;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('.chief-drawer') != null) return;
      if (document.querySelector(OPEN_SURFACE) != null) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (!wantsFocus) return;
    ref.current?.querySelector<HTMLElement>(`[data-panel-head] :is(${HEAD_CONTROL})`)?.focus();
    focusTaken();
  }, [wantsFocus, focusTaken]);

  const view = useMemo<TaskView | null>(() => {
    if (taskId == null) return null;
    const todo = todos.find((item) => item.id === taskId) ?? null;
    return {
      id: taskId,
      title: todo?.title ?? seed?.title ?? null,
      seq: todo?.seqNum ?? seed?.seq ?? null,
      phase: todo?.phase ?? seed?.phase ?? null,
      todo,
    };
  }, [taskId, todos, seed]);

  return (
    <>
      <div
        data-testid="task-panel-scrim"
        aria-hidden
        className="task-panel-scrim absolute inset-0 z-(--z-backdrop-low) hidden bg-(--dialog-backdrop) max-[1100px]:block"
        onClick={close}
      />
      <aside
        ref={ref}
        aria-label={t('任务面板')}
        className="task-panel flex w-105 min-w-0 flex-none flex-col bg-background shadow-[inset_1px_0_0_var(--border)] max-[1100px]:absolute max-[1100px]:inset-y-0 max-[1100px]:right-0 max-[1100px]:z-(--z-panel-low) max-[1100px]:w-[min(420px,100%)] max-[1100px]:shadow-(--floating-shadow) max-[640px]:w-full"
      >
        {view == null ? (
          <ListView panel={panel} todos={todos} now={now} projectOf={projectOf} flash={flash} />
        ) : (
          <TaskDetail
            key={view.id}
            panel={panel}
            view={view}
            ready={ready}
            now={now}
            projectOf={projectOf}
          />
        )}
      </aside>
    </>
  );
}

function PanelHead({ children, panel }: { children: ReactNode; panel: TaskPanelApi }) {
  const { t } = useI18n();
  return (
    <div
      data-panel-head=""
      className="flex h-13 flex-none items-center gap-1 border-b border-border pr-2.5 pl-4"
    >
      {children}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-content-tertiary"
        aria-label={t('关闭面板')}
        onClick={panel.close}
      >
        <X aria-hidden strokeWidth={1.75} className="size-4" />
      </Button>
    </div>
  );
}

function ListView({
  panel,
  todos,
  now,
  projectOf,
  flash,
}: {
  panel: TaskPanelApi;
  todos: TodoRecord[];
  now: number;
  projectOf: (todo: TodoRecord) => string | undefined;
  flash: ReadonlySet<string>;
}) {
  const { t } = useI18n();
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set(['done']));
  const [staleOpen, setStaleOpen] = useState(false);
  const row = (todo: TodoRecord) => (
    <TaskRow
      key={todo.id}
      todo={todo}
      now={now}
      project={projectOf(todo)}
      flash={flash.has(todo.id)}
      onOpen={(focus) => panel.openTask(todo.id, { focus })}
    />
  );
  return (
    <>
      <PanelHead panel={panel}>
        <h2 className="m-0 min-w-0 flex-1 truncate text-ui font-medium text-foreground">
          {t('任务')}
        </h2>
      </PanelHead>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-6">
        {GROUPS.map((group) => {
          const column = COLUMNS.find((c) => c.id === group.column);
          const all = column == null ? [] : sortColumnTodos(column, todos.filter(column.accepts));
          const { fresh, stale } =
            group.column === 'pending' ? splitStale(all, now) : { fresh: all, stale: [] };
          const open = !shut.has(group.column);
          return (
            <section key={group.column} aria-label={t(group.name)}>
              <Button
                variant="ghost"
                data-testid="task-panel-group"
                aria-expanded={open}
                className="h-8 w-full justify-start gap-1.5 px-1.5 text-meta font-normal text-content-tertiary aria-expanded:bg-transparent aria-expanded:text-content-tertiary"
                onClick={() =>
                  setShut((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(group.column);
                    else next.delete(group.column);
                    return next;
                  })
                }
              >
                <ChevronRight
                  aria-hidden
                  strokeWidth={1.75}
                  className={cn(
                    'size-3 transition-transform duration-(--dur-fast) ease-(--ease-standard)',
                    open && 'rotate-90',
                  )}
                />
                {t(group.name)}
                <span className="tabular-nums">· {fresh.length}</span>
              </Button>
              {open &&
                (fresh.length > 0 ? (
                  fresh.map(row)
                ) : group.column === 'pending' ? (
                  <p className="mx-1.5 mt-0.5 mb-2 rounded-(--radius-card) border border-dashed border-border px-4 py-3.5 text-meta text-content-tertiary">
                    {t(group.empty)}
                  </p>
                ) : (
                  <p className="m-0 px-2 pb-2 text-meta text-content-tertiary">{t(group.empty)}</p>
                ))}
              {open && stale.length > 0 && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="task-panel-stale"
                    aria-expanded={staleOpen}
                    className="ml-1 gap-1 font-normal text-content-tertiary aria-expanded:bg-transparent aria-expanded:text-content-tertiary"
                    onClick={() => setStaleOpen((value) => !value)}
                  >
                    {t('较早的 {count} 条', { count: stale.length })}
                    <span>{t('超过 7 天没动')}</span>
                  </Button>
                  {staleOpen && stale.map(row)}
                </>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TaskRow({
  todo,
  now,
  project,
  flash,
  onOpen,
}: {
  todo: TodoRecord;
  now: number;
  project: string | undefined;
  flash: boolean;
  onOpen: (focus: boolean) => void;
}) {
  const { t } = useI18n();
  const face = cardFace(todo);
  const attention = face.kind === 'attention' ? ATTENTION[face.need] : null;
  const AttentionIcon = attention?.icon;
  return (
    <Button
      variant="ghost"
      data-testid="task-panel-row"
      data-flash={flash || undefined}
      className="task-panel-row grid h-auto w-full grid-cols-[16px_minmax(0,1fr)_auto] items-start justify-stretch gap-x-2.5 gap-y-0 rounded-(--radius-card) px-2.5 py-2 text-left font-normal whitespace-normal text-foreground hover:bg-secondary active:not-aria-[haspopup]:translate-y-0"
      onClick={(event) => onOpen(event.detail === 0)}
    >
      <span className="mt-0.5 flex size-4 items-center justify-center">
        {AttentionIcon != null ? (
          <AttentionIcon
            aria-hidden
            strokeWidth={1.75}
            className={cn('size-3.75', NEEDS_YOU_INK)}
          />
        ) : (
          <TodoStatus phase={todo.phase} />
        )}
      </span>
      <span className="truncate text-ui">{todo.title}</span>
      <span className="text-meta tabular-nums text-content-tertiary">
        {relativeTime(todo.phaseAt, now, t)}
      </span>
      <span className="col-start-2 col-end-4 flex min-w-0 gap-2.5 text-meta text-content-tertiary">
        {project != null && <span className="truncate">{project}</span>}
        <span className="flex-none tabular-nums">#{todo.seqNum}</span>
        <span className={cn('flex-none', attention != null && NEEDS_YOU_INK)}>
          {t(attention?.label ?? PHASE_UI[todo.phase].chip)}
        </span>
      </span>
    </Button>
  );
}

const STAGE_ICON: Record<StageState, ReactNode> = {
  done: <CircleCheck aria-hidden strokeWidth={1.75} className="size-4 text-content-tertiary" />,
  cur: (
    <LoaderCircle
      aria-hidden
      strokeWidth={1.75}
      className="size-4 text-running motion-safe:animate-spin"
    />
  ),
  wait: <CircleAlert aria-hidden strokeWidth={1.75} className={cn('size-4', NEEDS_YOU_INK)} />,
  failed: <CircleX aria-hidden strokeWidth={1.75} className={cn('size-4', NEEDS_YOU_INK)} />,
  not: <CircleDashed aria-hidden strokeWidth={1.75} className="size-4 text-content-dim" />,
};

const STAGE_STATE_LABEL: Record<StageState, string> = {
  done: '已完成',
  cur: '进行中',
  wait: '待处理',
  failed: '失败',
  not: '未开始',
};

function TaskDetail({
  panel,
  view,
  ready,
  now,
  projectOf,
}: {
  panel: TaskPanelApi;
  view: TaskView;
  ready: boolean;
  now: number;
  projectOf: (todo: TodoRecord) => string | undefined;
}) {
  const { t } = useI18n();
  const { search } = useLocation();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const { todo } = view;
  const face = todo == null ? null : cardFace(todo);
  const need = face?.kind === 'attention' ? face.need : null;
  const stages =
    view.phase == null
      ? null
      : stagesFor(view.phase, {
          awaitingReply: todo?.awaitingReply === true,
          hasPlan: todo?.hasPlan ?? true,
        });
  const href = `/app/todo/${view.id}${search}`;
  const project = todo == null ? undefined : projectOf(todo);
  return (
    <>
      <PanelHead panel={panel}>
        <h2 className="m-0 flex min-w-0 flex-1 items-center gap-1.5 truncate text-ui font-medium text-foreground">
          <Button
            variant="ghost"
            size="xs"
            className="-ml-2 text-ui font-medium text-content-tertiary"
            onClick={(event) => panel.showList({ focus: event.detail === 0 })}
          >
            {t('任务')}
          </Button>
          <ChevronRight
            aria-hidden
            strokeWidth={1.75}
            className="size-3 flex-none text-content-dim"
          />
          {view.seq != null && <span className="tabular-nums">#{view.seq}</span>}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-content-tertiary"
          aria-label={t('展开为整页')}
          title={t('展开为整页')}
          render={<Link to={href} onClick={panel.close} />}
        >
          <Maximize2 aria-hidden strokeWidth={1.75} className="size-3.75" />
        </Button>
      </PanelHead>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-6">
        {view.title == null && !ready ? (
          <div data-testid="task-panel-loading" className="flex flex-col gap-2 pt-1">
            <Skeleton className="bg-accent h-4 w-4/5" />
            <Skeleton className="bg-accent h-3 w-2/5" />
          </div>
        ) : view.title == null ? (
          <p className="m-0 text-ui text-content-secondary">{t('找不到这个任务')}</p>
        ) : (
          <div>
            <h3
              data-testid="task-panel-title"
              className="m-0 text-heading font-medium text-foreground wrap-break-word"
            >
              {view.title}
            </h3>
            <div
              data-testid="task-panel-meta"
              className="mt-1 flex flex-wrap items-center gap-1.5 text-meta text-content-tertiary"
            >
              {[
                project,
                todo?.agent?.displayName,
                view.phase == null ? undefined : t(PHASE_UI[view.phase].chip),
                todo == null ? undefined : relativeTime(todo.phaseAt, now, t),
              ]
                .filter((part) => part != null)
                .join(' · ')}
            </div>
          </div>
        )}
        {need != null && (
          <div
            data-testid="task-panel-ask"
            className="rounded-(--radius-card) px-3.5 py-3 text-ui text-content-secondary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--card-button)_45%,transparent)]"
          >
            <b className={cn('block font-medium', NEEDS_YOU_INK)}>{t(ATTENTION[need].label)}</b>
            {t(ASK_HINT[need])}
            <div className="mt-2.5 flex gap-2">
              {need === 'reply' ? (
                <Button variant="outline" size="sm" onClick={() => composerRef.current?.focus()}>
                  {t(ATTENTION[need].action)}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link to={href} onClick={panel.close} />}
                >
                  {t(ATTENTION[need].action)}
                </Button>
              )}
            </div>
          </div>
        )}
        {stages != null && (
          <div className="grid gap-0.5 rounded-(--radius-card) bg-card px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]">
            <div className="mb-1 text-meta text-content-tertiary">
              {t('进度 · {done}/{total}', {
                done: stages.filter((s) => s === 'done').length,
                total: STAGES.length,
              })}
            </div>
            {STAGES.map((name, i) => {
              const state = stages[i] ?? 'not';
              return (
                <div
                  key={name}
                  data-testid="task-panel-stage"
                  data-state={state}
                  className={cn(
                    'flex min-h-6.5 items-center gap-2 text-ui',
                    state === 'done' && 'text-content-tertiary',
                    (state === 'cur' || state === 'wait' || state === 'failed') && 'font-medium',
                  )}
                >
                  {STAGE_ICON[state]}
                  {t(name)}
                  <span className="sr-only">{t(STAGE_STATE_LABEL[state])}</span>
                </div>
              );
            })}
          </div>
        )}
        {todo != null && <LastSummary todo={todo} />}
      </div>
      {todo != null && (
        <PanelComposer todo={todo} replying={need === 'reply'} inputRef={composerRef} />
      )}
    </>
  );
}

function LastSummary({ todo }: { todo: TodoRecord }) {
  const { live } = useLiveData();
  const messagesQ = useMessages(todo.latestBuildId, live);
  const text = useMemo(() => {
    const rows = messagesQ.data?.messages ?? [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row?.role !== 'assistant') continue;
      const body = textOfContent(row.content).trim();
      if (body !== '') return body;
    }
    return null;
  }, [messagesQ.data]);
  if (text == null) return null;
  return (
    <p
      data-testid="task-panel-summary"
      className="m-0 line-clamp-6 text-ui leading-relaxed whitespace-pre-wrap text-content-secondary"
    >
      {text}
    </p>
  );
}

const noop = () => {};
const STEERABLE: ReadonlySet<Phase> = new Set<Phase>(['building', 'review', 'failed']);

function PanelComposer({
  todo,
  replying,
  inputRef,
}: {
  todo: TodoRecord;
  replying: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const stepsQ = useSteps(todo.latestBuildId, live);
  const running = (stepsQ.data ?? []).some((s) => s.status === 'claimed' || s.status === 'pending');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const { onSend } = useDetailComposer({
    live,
    phase: todo.phase,
    buildId: todo.latestBuildId,
    running,
    mutations,
    scrollToEnd: noop,
    clearDraft: noop,
    chain: 'idle',
    setChain: noop,
    revisionAvailable: false,
  });
  if (!live || onSend == null || todo.latestBuildId == null || !STEERABLE.has(todo.phase))
    return null;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text === '' || sending) return;
    setSending(true);
    Promise.resolve(onSend(text))
      .then(() => setDraft(''))
      .catch(noop)
      .finally(() => setSending(false));
  };
  return (
    <form className="flex-none px-3 pt-2.5 pb-3" onSubmit={submit}>
      <div className="flex items-end gap-2 rounded-(--radius-composer) bg-card py-2 pr-2 pl-3.5 shadow-(--shadow-composer) transition-[box-shadow] duration-(--dur-fast) ease-(--ease-standard) focus-within:shadow-(--shadow-composer-focus) dark:bg-(--secondary)">
        <Textarea
          ref={inputRef}
          rows={1}
          value={draft}
          aria-label={t('引导这个任务')}
          placeholder={t(replying ? '回复 agent…' : '引导这个任务…')}
          className="max-h-40 min-h-7 min-w-0 flex-1 resize-none rounded-none border-none bg-transparent px-0 py-1 text-ui text-foreground shadow-none placeholder:text-content-tertiary focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none md:text-ui dark:bg-transparent"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)
              submit(event);
          }}
        />
        <Button
          type="submit"
          size="icon-sm"
          aria-label={t('发送')}
          disabled={draft.trim() === '' || sending}
        >
          <ArrowUp aria-hidden strokeWidth={2} className="size-3.75" />
        </Button>
      </div>
    </form>
  );
}
