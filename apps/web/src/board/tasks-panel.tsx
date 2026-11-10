import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
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
import { relativeTime } from './rel-time.js';
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

export type TasksTab = 'active' | 'next' | 'scheduled' | 'resolved';

function SectionHeader({ section, count }: { section: TaskSection; count: number }) {
  const { t } = useI18n();
  const accent = isWaiting(section);
  return (
    <h3
      className={cn(
        'm-0 flex h-8 items-center gap-1.5 px-2.5 text-meta font-medium',
        accent ? 'text-foreground' : 'text-content-tertiary',
      )}
    >
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

interface TasksPanelProps {
  entries: readonly TaskEntry[];
  questions: readonly StandaloneQuestion[];
  projectId: string | null;
  now: number;
  onClose: () => void;
  onOpenThread: (id: string) => void;
  onOpenQuestion: (question: QuestionTarget) => void;
  onNewTask: () => void;
  onAddTask: (text: string) => void | Promise<void>;
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
  onNewTask,
  onAddTask,
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
  const row = (entry: TaskEntry) => {
    const pr = prOf.get(entry.todo.id);
    const copy: TaskRowCopy = taskRowCopy(entry, pr);
    return (
      <TaskRow
        key={entry.todo.id}
        {...(pr === undefined ? {} : { prLink: { number: pr.number, url: pr.url } })}
        title={entry.todo.title}
        glyph={glyphOf(entry)}
        word={t(copy.word)}
        what={say(copy.what)}
        where={copy.where === null ? null : t(copy.where)}
        age={relativeTime(entry.todo.phaseAt, now, t)}
        waiting={copy.waiting}
        running={copy.running}
        muted={entry.section === 'resolved'}
        onOpen={() => onOpenThread(entry.todo.id)}
      />
    );
  };
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
      onOpen={() => onOpenQuestion(question)}
    />
  ));
  const count = (section: ActiveSection) =>
    groups[section].length + (section === 'needs_input' ? questions.length : 0);
  const empty =
    entries.length === 0 && questions.length === 0 ? (
      <EmptyState
        testId="tasks-empty"
        icon={ListChecks}
        title={t('现在没有任务')}
        description={t('跟 Coordinator 说一件事，它会在这里出现。')}
        action={{ label: t('给 Coordinator 发消息'), onClick: onNewTask }}
        className="mt-6"
      />
    ) : null;
  const activeCount = ACTIVE_SECTIONS.reduce((sum, section) => sum + count(section), 0);
  const quiet = (text: string) => (
    <p data-testid="tasks-quiet" className="m-0 px-2.5 py-2 text-meta text-content-tertiary">
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
            className="flex flex-col"
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
      <section data-testid="tasks-section" data-section={section} className="flex flex-col">
        {groups[section].map(row)}
      </section>
    );
  const body =
    tab === 'active' ? (
      active
    ) : tab === 'next' ? (
      listOf('up_next', t('接下来没有安排'))
    ) : tab === 'scheduled' ? (
      <div className="flex flex-col">
        <TasksScheduleList projectId={projectId} now={now} />
      </div>
    ) : (
      listOf('resolved', t('还没有完成的任务'))
    );
  return (
    <SidePanel label={t('任务')} onDismiss={onClose} phoneTab>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('任务')}</SidePanelTitle>
        <IconTooltip
          label={t('新任务')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              data-testid="tasks-new"
              aria-pressed={adding}
              onClick={() => setAdding((v) => !v)}
              className="size-7.5 text-content-tertiary aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
            />
          }
        >
          <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        </IconTooltip>
      </SidePanelHead>
      {adding && (
        <TasksAddInput
          onClose={() => setAdding(false)}
          onSubmit={(text) => {
            setAdding(false);
            void onAddTask(text);
          }}
        />
      )}
      <div className="flex flex-none px-3 pt-3">
        <SegmentedTabs
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
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
        <QueryBoundary
          query={query}
          isEmpty={empty !== null}
          loadingLabel={t('正在加载任务')}
          errorTitle={t('任务没能加载')}
          empty={body}
        >
          {body}
        </QueryBoundary>
      </div>
    </SidePanel>
  );
}
