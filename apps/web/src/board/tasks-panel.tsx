import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { CircleCheck, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useApiMutations, usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { questionDockState } from '../chief/question-dock-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import type { GlyphKind } from '../components/status-glyph.js';
import { TaskPrLine, TaskPrLineSkeleton } from '../components/thread/task-pr-line.js';
import { TaskRow } from '../components/thread/task-row.js';
import { Button } from '../components/ui/button.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { ACCENT_INK } from '../phase.js';
import { compactAge, relativeTime, shortDate } from './rel-time.js';
import { StopAndDoneConfirm } from './stop-and-done-confirm.js';
import { TaskRowMenu } from './task-row-menu.js';
import { TasksAddInput } from './tasks-add-input.js';
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

export type TasksTab = 'active' | 'next' | 'scheduled' | 'resolved';

export type TaskAddOutcome = 'saved' | 'sent';

export const PANEL_HEAD = 'gap-0.5 pr-4 pl-4';
export const PANEL_HEAD_BUTTON = 'size-9 text-foreground [&_svg]:size-5.5';
export const PANEL_TITLE = 'text-heading font-normal';
const PANEL_TABS = 'h-7.5 gap-0.5 group-data-horizontal/tabs:h-7.5';
const PANEL_TAB =
  'h-7.5 px-2.5 text-ui text-foreground data-active:font-normal dark:text-foreground';

function SectionHeader({ section, count }: { section: TaskSection; count: number }) {
  const { t } = useI18n();
  const accent = isWaiting(section);
  return (
    <h3 className="m-0 flex h-8 items-center gap-2 px-2.5 text-ui font-normal text-foreground">
      {t(SECTION_LABEL[section])}
      <span className={cn('tabular-nums', accent ? ACCENT_INK : 'text-content-tertiary')}>
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
  if (todo.phase === 'closed') return { glyph: 'closed', why: '已关闭' };
  if (todo.phase === 'done') return { glyph: 'done', why: '已完成' };
  return { glyph: 'todo', why: '已归档，不能标记完成' };
}

function PanelTaskRow({
  entry,
  prs,
  prsPending,
  selected,
  onToggle,
  now,
  onOpenThread,
}: {
  selected: boolean;
  onToggle: () => void;
  entry: TaskEntry;
  prs: readonly PrPanelRow[];
  prsPending: boolean;
  now: number;
  onOpenThread: (id: string) => void;
}) {
  const { t } = useI18n();
  const { markDone, dialogs } = useMarkDone(entry.todo);
  const prefetch = usePrefetchThread();
  const copy: TaskRowCopy = taskRowCopy(entry, prs.find((pr) => pr.state !== 'merged') ?? prs[0]);
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
            <TaskPrLine prs={prs} now={now} />
          ) : prsPending && entry.todo.latestBuildId !== null ? (
            <TaskPrLineSkeleton />
          ) : null
        }
        onOpen={open}
        onIntent={() => prefetch(entry.todo.id)}
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
  onOpenThread,
  onOpenQuestion,
  onAddTask,
  addBlocked = null,
  query,
}: TasksPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TasksTab>('active');
  const [adding, setAdding] = useState(false);
  const groups = bySection(entries);
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
  const { live: connected, teamId } = useLiveData();
  const prsQuery = usePrs(teamId, undefined, connected);
  const prs = (prsQuery.data ?? []).filter(
    (pr) => projectId === null || pr.projectId === projectId,
  );
  const prsOf = new Map<string, PrPanelRow[]>();
  for (const pr of prs) prsOf.set(pr.threadId, [...(prsOf.get(pr.threadId) ?? []), pr]);
  const say = (phrase: Phrase) => t(phrase.key, phrase.params);
  const row = (entry: TaskEntry) => (
    <PanelTaskRow
      key={entry.todo.id}
      entry={entry}
      prs={prsOf.get(entry.todo.id) ?? []}
      prsPending={connected && prsQuery.isPending}
      selected={picked.has(entry.todo.id)}
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
  const empty =
    entries.length === 0 && questions.length === 0 && !adding ? (
      <div
        data-testid="tasks-empty"
        className="mt-16 flex flex-col items-center gap-3 px-6 text-center"
      >
        <p className="m-0 text-ui text-content-secondary">{t('现在没有任务')}</p>
        <p className="m-0 text-meta text-content-secondary">
          {t('跟 Coordinator 说一件事，它会在这里出现。')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          {t('添加任务')}
        </Button>
      </div>
    ) : null;
  const activeCount = ACTIVE_SECTIONS.reduce((sum, section) => sum + count(section), 0);
  const quiet = (text: string) => (
    <p data-testid="tasks-quiet" className="m-0 px-2.5 py-2 text-ui text-content-tertiary">
      {text}
    </p>
  );
  const active = (
    <div className="flex flex-col gap-2">
      {empty}
      {empty === null && activeCount === 0 && quiet(t('现在没有进行中的任务'))}
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
            <SectionHeader section={section} count={n} />
            {section === 'needs_input' && questionRows}
            {groups[section].map(row)}
          </section>
        );
      })}
    </div>
  );
  const listOf = (section: 'up_next' | 'resolved', emptyText: string) =>
    groups[section].length === 0 ? (
      quiet(emptyText)
    ) : (
      <section data-testid="tasks-section" data-section={section} className="flex flex-col gap-0.5">
        <SectionHeader section={section} count={groups[section].length} />
        {groups[section].map(row)}
      </section>
    );
  const body =
    tab === 'active'
      ? active
      : tab === 'next'
        ? listOf('up_next', t('接下来没有安排'))
        : listOf('resolved', t('还没有完成的任务'));
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
        {tab === 'scheduled' ? (
          <TasksScheduleList projectId={projectId} now={now} />
        ) : (
          <QueryBoundary
            query={query}
            isEmpty={empty !== null}
            loadingLabel={t('正在加载任务')}
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
