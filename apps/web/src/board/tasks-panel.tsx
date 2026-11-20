import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { CircleCheck, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useApiMutations, useProjects, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { questionDockState } from '../chief/question-dock-state.js';
import { useArrivals } from '../components/growth.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import type { GlyphKind } from '../components/status-glyph.js';
import { TaskPrLine, TaskPrLineSkeleton } from '../components/thread/task-pr-line.js';
import { TaskRow } from '../components/thread/task-row.js';
import { Button } from '../components/ui/button.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { ACCENT_INK } from '../phase.js';
import { newTaskRequest } from './open-composer.js';
import { compactAge, relativeTime, shortDate } from './rel-time.js';
import { StopAndDoneConfirm } from './stop-and-done-confirm.js';
import { TaskRowMenu } from './task-row-menu.js';
import { TasksAddInput } from './tasks-add-input.js';
import { TasksEmpty } from './tasks-empty.js';
import { TasksScheduleList } from './tasks-schedule-list.js';
import {
  ACTIVE_SECTIONS,
  type ActiveSection,
  bySection,
  glyphOf,
  isWaiting,
  type Phrase,
  type QuestionTarget,
  questionRowCopy,
  SECTION_LABEL,
  type StandaloneQuestion,
  type TaskEntry,
  type TaskRowCopy,
  type TaskSection,
  taskRowCopy,
} from './tasks-sections.js';
import { usePrefetchThread } from './thread-link.js';
import { canMarkDone, useMarkDone } from './use-mark-done.js';
import { TASKS_TAB_PARAM } from './work-panel.js';

export type TasksTab = 'active' | 'next' | 'scheduled' | 'resolved';

export type TaskAddOutcome = 'saved' | 'sent';

export const PANEL_HEAD = 'gap-0.5 pr-4 pl-4';
export const PANEL_HEAD_BUTTON = 'size-9 text-foreground pointer-coarse:size-11 [&_svg]:size-5.5';
export const PANEL_TITLE = 'text-heading font-normal';
const PANEL_TABS = 'h-7.5 gap-0.5 group-data-horizontal/tabs:h-7.5';
const PANEL_TAB =
  'h-7.5 px-2.5 text-ui text-foreground data-active:font-normal dark:text-foreground';

const SKELETON_BAR = 'animate-none rounded-sm bg-border';

function TasksSkeleton() {
  return (
    <div data-testid="tasks-skeleton" aria-hidden="true" className="flex flex-col gap-0.5">
      <div className="flex h-8 items-center px-2.5">
        <Skeleton className={`h-3 w-14 ${SKELETON_BAR}`} />
      </div>
      {[0.6, 0.45, 0.7].map((width) => (
        <div key={width} className="flex h-14 items-start gap-4 px-2.5 py-2">
          <span className="flex size-7 flex-none items-center justify-center">
            <Skeleton className={`size-4 rounded-full ${SKELETON_BAR}`} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1.5">
            <Skeleton className={`h-3 ${SKELETON_BAR}`} style={{ width: `${width * 100}%` }} />
            <Skeleton className={`h-2.5 w-1/3 ${SKELETON_BAR}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

const MOVE_FRESH_MS = 1500;

function useMoved(entries: readonly TaskEntry[], ready: boolean): ReadonlySet<string> {
  const placed = useRef<Map<string, TaskSection> | null>(null);
  const movedAt = useRef(new Map<string, number>());
  if (!ready) return new Set();
  const now = Date.now();
  const before = placed.current;
  placed.current = new Map(entries.map((entry) => [entry.todo.id, entry.section]));
  if (before !== null)
    for (const entry of entries) {
      const was = before.get(entry.todo.id);
      if (was !== undefined && was !== entry.section) movedAt.current.set(entry.todo.id, now);
    }
  return new Set(
    entries
      .map((entry) => entry.todo.id)
      .filter((id) => now - (movedAt.current.get(id) ?? -Infinity) < MOVE_FRESH_MS),
  );
}

function SectionHeader({
  section,
  count,
  flash = false,
}: {
  section: TaskSection;
  count: number;
  flash?: boolean;
}) {
  const { t } = useI18n();
  const accent = isWaiting(section);
  return (
    <h3 className="m-0 flex h-8 items-center gap-2 px-2.5 text-ui font-normal text-foreground">
      {t(SECTION_LABEL[section])}
      <span
        key={flash ? count : undefined}
        data-flash={flash ? '' : undefined}
        className={cn(
          'tabular-nums',
          accent ? ACCENT_INK : 'text-content-tertiary',
          flash && 'grow-flash',
        )}
      >
        {count}
      </span>
    </h3>
  );
}

function SelectionBar({
  todos,
  onClear,
}: {
  todos: readonly TaskEntry['todo'][];
  onClear: () => void;
}) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const { stopAndDoneTodo } = useApiMutations(teamId);
  const [confirming, setConfirming] = useState(false);
  const resolve = async () => {
    setConfirming(false);
    const results = await Promise.allSettled(
      todos.map((todo) => stopAndDoneTodo.mutateAsync(todo.id)),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) toastError(t('{n} 个任务没能标记完成，请重试。', { n: failed }), null);
    else toastSuccess(t('{n} 个任务已标记完成。', { n: todos.length }));
    onClear();
  };
  const running = todos.some((todo) => todo.phase !== 'todo' && todo.phase !== 'review');
  return (
    <div
      data-slot="tasks-selection-bar"
      className="sticky bottom-2 z-10 mx-auto mt-auto flex h-11 w-fit items-center rounded-xl bg-foreground px-1.5 text-ui text-background shadow-(--e3)"
    >
      <span className="px-3 text-background/60 tabular-nums">
        {t('已选 {n} 个', { n: todos.length })}
      </span>
      <span aria-hidden className="h-5 w-px bg-background/20" />
      <Button
        variant="ghost"
        data-testid="tasks-selection-resolve"
        onClick={() => (running ? setConfirming(true) : void resolve())}
        className="h-8 gap-2 px-3 text-ui text-background hover:bg-background/12 hover:text-background dark:hover:bg-background/12"
      >
        <CircleCheck aria-hidden className="size-5" />
        {t('完成')}
      </Button>
      <span aria-hidden className="h-5 w-px bg-background/20" />
      <IconTooltip
        label={t('取消选择')}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('取消选择')}
            onClick={onClear}
            className="size-8 text-background hover:bg-background/12 hover:text-background dark:hover:bg-background/12"
          />
        }
      >
        <X aria-hidden className="size-5" />
      </IconTooltip>
      <StopAndDoneConfirm
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void resolve()}
      />
    </div>
  );
}

function unfinishableLead(todo: TaskEntry['todo']): { glyph: GlyphKind; why: string } {
  if (todo.phase === 'failed') return { glyph: 'failed', why: '运行失败了，先重跑才能完成' };
  if (todo.phase === 'closed') return { glyph: 'closed', why: '已归档' };
  if (todo.phase === 'done') return { glyph: 'done', why: '已完成' };
  return { glyph: 'todo', why: '已归档，不能标记完成' };
}

function PanelTaskRow({
  entry,
  lookup,
  place,
  prs,
  prsArrived,
  prsPending,
  moved,
  selected,
  open: expanded,
  onToggle,
  now,
  onOpenThread,
}: {
  selected: boolean;
  open: boolean;
  onToggle: () => void;
  entry: TaskEntry;
  lookup: (id: string) => TaskEntry['todo'] | undefined;
  place: string | undefined;
  prs: readonly PrPanelRow[];
  prsArrived: ReadonlySet<string>;
  prsPending: boolean;
  moved: boolean;
  now: number;
  onOpenThread: (id: string) => void;
}) {
  const { t } = useI18n();
  const { markDone, dialogs } = useMarkDone(entry.todo);
  const prefetch = usePrefetchThread();
  const copy: TaskRowCopy = taskRowCopy(
    entry,
    prs.find((pr) => pr.state !== 'merged') ?? prs[0],
    lookup,
  );
  const open = () => onOpenThread(entry.todo.id);
  const unfinishable = canMarkDone(entry.todo) ? null : unfinishableLead(entry.todo);
  return (
    <>
      <TaskRow
        title={entry.todo.title}
        glyph={unfinishable?.glyph ?? glyphOf(entry)}
        {...(unfinishable === null ? {} : { why: t(unfinishable.why) })}
        word={t(copy.word)}
        what={t(copy.what.key, copy.what.params)}
        where={copy.where === null ? null : t(copy.where)}
        age={relativeTime(entry.todo.phaseAt, now, t)}
        stamp={compactAge(entry.todo.phaseAt, now)}
        {...(entry.section === 'resolved' ? { date: shortDate(entry.todo.phaseAt, t) } : {})}
        waiting={copy.waiting}
        {...(place !== undefined ? { place } : {})}
        muted={entry.section === 'resolved'}
        check={
          unfinishable === null
            ? {
                label: t('选择：{title}', { title: entry.todo.title }),
                checked: selected,
                onCheck: onToggle,
              }
            : 'none'
        }
        menu={<TaskRowMenu todo={entry.todo} onOpen={open} onMarkDone={markDone} />}
        below={
          prs.length > 0 ? (
            <TaskPrLine prs={prs} now={now} arrived={prsArrived} />
          ) : prsPending && entry.todo.latestBuildId !== null ? (
            <TaskPrLineSkeleton />
          ) : null
        }
        onOpen={open}
        open={expanded}
        onIntent={() => prefetch(entry.todo.id)}
        grow={moved}
      />
      {dialogs}
    </>
  );
}

interface TasksPanelProps {
  entries: readonly TaskEntry[];
  questions: readonly StandaloneQuestion[];
  projectId: string | null;
  now: number;
  onClose: () => void;
  openThreadId?: string | null;
  onOpenThread: (id: string) => void;
  onOpenQuestion: (question: QuestionTarget) => void;
  onAddTask: (text: string) => Promise<TaskAddOutcome>;
  addBlocked?: string | null;
  query?: QueryLike;
}

export function TasksPanel({
  entries,
  questions,
  projectId,
  now,
  onClose,
  openThreadId = null,
  onOpenThread,
  onOpenQuestion,
  onAddTask,
  addBlocked = null,
  query,
}: TasksPanelProps) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedToScheduled = searchParams.get(TASKS_TAB_PARAM) === 'scheduled';
  const [chosenTab, setTab] = useState<TasksTab | null>(null);
  const [adding, setAdding] = useState(false);
  const newTaskAt = newTaskRequest(useLocation().state);
  useEffect(() => {
    if (newTaskAt !== null) setAdding(true);
  }, [newTaskAt]);
  const groups = bySection(entries);
  const listed = new Map(entries.map((entry) => [entry.todo.id, entry.todo]));
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const selectedTodos = entries
    .filter((entry) => picked.has(entry.todo.id) && canMarkDone(entry.todo))
    .map((entry) => entry.todo);
  const clearPicked = () => setPicked(new Set());
  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  useEffect(() => {
    if (picked.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicked(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked.size]);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (openThreadId === null || list === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const rows = [...list.querySelectorAll<HTMLElement>('[data-thread-row]')];
      const at = rows.findIndex((row) => row.contains(event.target as Node));
      const next = at === -1 ? undefined : rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next === undefined) return;
      event.preventDefault();
      next.focus();
      next.click();
    };
    list.addEventListener('keydown', onKey);
    return () => list.removeEventListener('keydown', onKey);
  }, [openThreadId]);
  const { live: connected, teamId } = useLiveData();
  const prsQuery = usePrs(teamId, undefined, connected);
  const prs = (prsQuery.data ?? []).filter(
    (pr) => projectId === null || pr.projectId === projectId,
  );
  const projects = useProjects(teamId, connected && projectId === null).data;
  const placeOf = (entry: TaskEntry) =>
    projectId === null ? projects?.find((p) => p.id === entry.todo.projectId)?.name : undefined;
  const prsArrived = useArrivals(
    prs.map((pr) => pr.buildId),
    prsQuery.data !== undefined,
  );
  const prsOf = new Map<string, PrPanelRow[]>();
  for (const pr of prs) prsOf.set(pr.threadId, [...(prsOf.get(pr.threadId) ?? []), pr]);
  const moved = useMoved(entries, query === undefined || !query.isPending);
  const received = (section: TaskSection) =>
    groups[section].some((entry) => moved.has(entry.todo.id));
  const say = (phrase: Phrase) => t(phrase.key, phrase.params);
  const row = (entry: TaskEntry) => (
    <PanelTaskRow
      key={entry.todo.id}
      entry={entry}
      lookup={(id) => listed.get(id)}
      place={placeOf(entry)}
      prs={prsOf.get(entry.todo.id) ?? []}
      prsArrived={prsArrived}
      prsPending={connected && prsQuery.isPending}
      moved={moved.has(entry.todo.id)}
      selected={picked.has(entry.todo.id)}
      open={entry.todo.id === openThreadId}
      onToggle={() => togglePicked(entry.todo.id)}
      now={now}
      onOpenThread={onOpenThread}
    />
  );
  const questionCopy = questionRowCopy();
  const questionRows = questions.map((question) => (
    <TaskRow
      key={question.requestId}
      title={question.header}
      glyph="question"
      word={t(questionCopy.word)}
      what={say(questionCopy.what)}
      where={questionCopy.where === null ? null : t(questionCopy.where)}
      age={relativeTime(question.createdAt, now, t)}
      waiting
      why={t('Coordinator 在问你，到对话里回答')}
      check="none"
      onOpen={() => {
        if (questionDockState.uploading()) {
          toast(t('附件上传中'));
          return;
        }
        onOpenQuestion(question);
      }}
    />
  ));
  const count = (section: ActiveSection) =>
    groups[section].length + (section === 'needs_input' ? questions.length : 0);
  const nothingAtAll = entries.length === 0 && questions.length === 0;
  const activeCount = ACTIVE_SECTIONS.reduce((sum, section) => sum + count(section), 0);
  const loaded = query === undefined || !query.isPending;
  const openingTab: TasksTab = activeCount === 0 && groups.up_next.length > 0 ? 'next' : 'active';
  useEffect(() => {
    if (chosenTab === null && loaded) setTab(openingTab);
  }, [chosenTab, loaded, openingTab]);
  const tab = linkedToScheduled ? 'scheduled' : (chosenTab ?? openingTab);
  const addAction = adding ? null : (
    <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
      {t('添加任务')}
    </Button>
  );
  const tellCoordinator = t('跟 Coordinator 说一件事，它会在这里出现。');
  const activeEmpty =
    groups.up_next.length > 0 ? (
      <TasksEmpty
        title={t('现在没有进行中的任务')}
        hint={t('接下来有 {n} 个任务在排队。', { n: groups.up_next.length })}
        action={
          <Button variant="secondary" size="sm" onClick={() => setTab('next')}>
            {t('查看接下来')}
          </Button>
        }
      />
    ) : (
      <TasksEmpty
        title={t(nothingAtAll ? '现在没有任务' : '现在没有进行中的任务')}
        hint={tellCoordinator}
        action={addAction}
      />
    );
  const active =
    activeCount === 0 ? (
      activeEmpty
    ) : (
      <div className="flex flex-col gap-2">
        {ACTIVE_SECTIONS.map((section) => {
          const n = count(section);
          if (n === 0) return null;
          return (
            <section
              key={section}
              data-testid="tasks-section"
              data-section={section}
              className="flex flex-col gap-0.5"
            >
              <SectionHeader section={section} count={n} flash={received(section)} />
              {section === 'needs_input' && questionRows}
              {groups[section].map(row)}
            </section>
          );
        })}
      </div>
    );
  const listOf = (section: 'up_next' | 'resolved', emptyState: ReactNode) =>
    groups[section].length === 0 ? (
      emptyState
    ) : (
      <section data-testid="tasks-section" data-section={section} className="flex flex-col gap-0.5">
        <SectionHeader section={section} count={groups[section].length} flash={received(section)} />
        {groups[section].map(row)}
      </section>
    );
  const body =
    tab === 'active'
      ? active
      : tab === 'next'
        ? listOf(
            'up_next',
            <TasksEmpty title={t('接下来没有安排')} hint={tellCoordinator} action={addAction} />,
          )
        : listOf(
            'resolved',
            <TasksEmpty
              title={t('还没有完成的任务')}
              hint={t('任务完成后会出现在这里。')}
              action={null}
            />,
          );
  return (
    <SidePanel label={t('任务')} onDismiss={onClose} phoneTab>
      <SidePanelHead
        closeLabel={t('关闭')}
        onClose={onClose}
        className={PANEL_HEAD}
        closeClassName={PANEL_HEAD_BUTTON}
      >
        <SidePanelTitle className={PANEL_TITLE}>{t('任务')}</SidePanelTitle>
        <IconTooltip
          label={addBlocked ?? t('新任务')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              data-testid="tasks-new"
              aria-pressed={adding}
              aria-disabled={addBlocked !== null || undefined}
              onClick={() => {
                if (addBlocked === null) setAdding((v) => !v);
              }}
              className={`${PANEL_HEAD_BUTTON} aria-pressed:bg-(--hover-1) aria-pressed:text-foreground`}
            />
          }
        >
          <Plus aria-hidden className="size-5.5" strokeWidth={1.75} />
        </IconTooltip>
      </SidePanelHead>
      <div className="flex flex-none px-2 pb-2">
        <SegmentedTabs
          quiet
          className={PANEL_TABS}
          optionHandle={PANEL_TAB}
          value={tab}
          onChange={(next) => {
            setTab(next);
            clearPicked();
            if (linkedToScheduled)
              setSearchParams(
                (params) => {
                  params.delete(TASKS_TAB_PARAM);
                  return params;
                },
                { replace: true },
              );
          }}
          options={[
            { value: 'active', label: t('进行中') },
            { value: 'next', label: t('接下来') },
            { value: 'scheduled', label: t('定时') },
            { value: 'resolved', label: t('已完成') },
          ]}
        />
      </div>
      {adding && addBlocked === null && (
        <TasksAddInput
          onClose={() => setAdding(false)}
          onSubmit={async (text) => {
            if ((await onAddTask(text)) === 'saved') setTab('next');
            else setAdding(false);
          }}
        />
      )}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
        {tab === 'scheduled' ? (
          <TasksScheduleList
            projectId={projectId}
            now={now}
            candidates={entries
              .filter((entry) => entry.todo.archivedAt == null)
              .map((entry) => {
                const place = placeOf(entry);
                return {
                  id: entry.todo.id,
                  title: entry.todo.title,
                  projectId: entry.todo.projectId,
                  ...(place === undefined ? {} : { place }),
                };
              })}
          />
        ) : (
          <QueryBoundary
            query={query}
            isEmpty={nothingAtAll}
            loadingLabel={t('正在加载任务')}
            skeleton={<TasksSkeleton />}
            errorTitle={t('任务没能加载')}
            empty={body}
          >
            {body}
          </QueryBoundary>
        )}
        {tab !== 'scheduled' && selectedTodos.length > 0 && (
          <SelectionBar todos={selectedTodos} onClear={clearPicked} />
        )}
      </div>
    </SidePanel>
  );
}
