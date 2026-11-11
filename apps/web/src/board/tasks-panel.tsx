import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { questionDockState } from '../chief/question-dock-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { PrList } from '../components/thread/pr-list.js';
import { prByThread } from '../components/thread/pr-panel-model.js';
import { TaskRow } from '../components/thread/task-row.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ACCENT_INK } from '../phase.js';
import { relativeTime, shortDate } from './rel-time.js';
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
import { THREAD_PARAM, VIEW_PARAM } from './thread-copy.js';
import { canMarkDone, useMarkDone } from './use-mark-done.js';

export type TasksTab = 'active' | 'next' | 'scheduled' | 'resolved';

export const PANEL_HEAD = 'h-13 gap-0.5 pr-4 pl-4';
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

function TasksPrList({
  prs,
  status,
  onRetry,
  onOpenThread,
}: {
  prs: readonly PrPanelRow[];
  status: 'error' | 'ok';
  onRetry: () => void;
  onOpenThread: (id: string) => void;
}) {
  const { t } = useI18n();
  const [, setSearchParams] = useSearchParams();
  return (
    <section data-testid="work-prs" className="flex flex-col pt-1">
      <h3 className="m-0 flex h-8 items-center gap-2 px-2.5 text-meta font-medium text-content-secondary">
        {t('拉取请求')}
        <span className="font-normal text-content-tertiary tabular-nums">{prs.length}</span>
      </h3>
      {status === 'error' ? (
        <p className="m-0 flex items-center gap-2 pb-2 pl-2.5 text-meta text-content-tertiary">
          {t('PR 列表加载失败，稍后会自动重试。')}
          <Button variant="ghost" size="sm" className="h-6.5 text-meta" onClick={onRetry}>
            {t('重试')}
          </Button>
        </p>
      ) : prs.length === 0 ? (
        <p className="m-0 pb-2 pl-2.5 text-meta text-content-tertiary">
          {t('任务开出 PR 后会列在这里。')}
        </p>
      ) : (
        <PrList
          rows={prs}
          onOpenThread={onOpenThread}
          onViewChanges={(pr) =>
            setSearchParams((prev) => {
              const params = new URLSearchParams(prev);
              params.set(THREAD_PARAM, pr.threadId);
              params.set(VIEW_PARAM, 'changes');
              return params;
            })
          }
        />
      )}
    </section>
  );
}

function PanelTaskRow({
  entry,
  pr,
  now,
  onOpenThread,
}: {
  entry: TaskEntry;
  pr: PrPanelRow | undefined;
  now: number;
  onOpenThread: (id: string) => void;
}) {
  const { t } = useI18n();
  const { markDone, dialogs } = useMarkDone(entry.todo);
  const copy: TaskRowCopy = taskRowCopy(entry, pr);
  const open = () => onOpenThread(entry.todo.id);
  return (
    <>
      <TaskRow
        {...(pr === undefined ? {} : { prLink: { number: pr.number, url: pr.url } })}
        title={entry.todo.title}
        glyph={glyphOf(entry)}
        word={t(copy.word)}
        what={t(copy.what.key, copy.what.params)}
        where={copy.where === null ? null : t(copy.where)}
        age={relativeTime(entry.todo.phaseAt, now, t)}
        {...(entry.section === 'resolved' ? { date: shortDate(entry.todo.phaseAt, t) } : {})}
        waiting={copy.waiting}
        running={copy.running}
        muted={entry.section === 'resolved'}
        check={
          canMarkDone(entry.todo)
            ? { label: t('标记完成：{title}', { title: entry.todo.title }), onCheck: markDone }
            : 'none'
        }
        menu={<TaskRowMenu todo={entry.todo} onOpen={open} onMarkDone={markDone} />}
        onOpen={open}
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
  onAddTask: (text: string) => void | Promise<void>;
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
  const { live: connected, teamId } = useLiveData();
  const prsQuery = usePrs(teamId, undefined, connected);
  const prs = (prsQuery.data ?? []).filter(
    (pr) => projectId === null || pr.projectId === projectId,
  );
  const prOf = prByThread(prs);
  const say = (phrase: Phrase) => t(phrase.key, phrase.params);
  const row = (entry: TaskEntry) => (
    <PanelTaskRow
      key={entry.todo.id}
      entry={entry}
      pr={prOf.get(entry.todo.id)}
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
      running={false}
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
    entries.length === 0 && questions.length === 0 ? (
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
      {connected && (
        <TasksPrList
          prs={prs}
          status={prsQuery.status === 'error' ? 'error' : 'ok'}
          onRetry={() => void prsQuery.refetch()}
          onOpenThread={onOpenThread}
        />
      )}
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
          onChange={setTab}
          options={[
            { value: 'active', label: t('进行中') },
            {
              value: 'next',
              label:
                groups.up_next.length > 0
                  ? t('接下来 {n}', { n: groups.up_next.length })
                  : t('接下来'),
            },
            { value: 'scheduled', label: t('定时') },
            { value: 'resolved', label: t('已完成') },
          ]}
        />
      </div>
      {adding && addBlocked === null && (
        <TasksAddInput
          onClose={() => setAdding(false)}
          onSubmit={async (text) => {
            await onAddTask(text);
            setAdding(false);
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
      </div>
    </SidePanel>
  );
}
