import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { CalendarClock, ChevronDown, ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { PrList } from '../components/thread/pr-list.js';
import { prByThread } from '../components/thread/pr-panel-model.js';
import { TaskRow, type TaskRowGlyph } from '../components/thread/task-row.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { ACCENT_INK } from '../phase.js';
import { relativeTime } from './rel-time.js';
import {
  ACTIVE_SECTIONS,
  type ActiveSection,
  bySection,
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

export type TasksTab = 'active' | 'next';

function glyphOf(entry: TaskEntry): TaskRowGlyph {
  switch (entry.section) {
    case 'ready_for_review':
      return 'three-quarter';
    case 'needs_input':
      return 'half';
    case 'resolved':
      return entry.todo.phase === 'closed' ? 'closed' : 'done';
    case 'up_next':
      return 'todo';
    case 'working':
      return 'ring';
  }
}

function SectionHeader({
  section,
  count,
  folded,
  onToggle,
}: {
  section: TaskSection;
  count: number;
  folded?: boolean;
  onToggle?: () => void;
}) {
  const { t } = useI18n();
  const accent = isWaiting(section);
  const body = (
    <>
      {t(SECTION_LABEL[section])}
      <span className={cn('tabular-nums', accent ? ACCENT_INK : 'text-content-tertiary')}>
        {count}
      </span>
      {folded !== undefined && (
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 text-content-dim transition-transform duration-(--dur-fast)',
            folded && '-rotate-90',
          )}
          strokeWidth={1.75}
        />
      )}
    </>
  );
  const cls = cn(
    'flex h-8 items-center gap-1.5 px-2.5 text-meta font-medium',
    accent ? 'text-foreground' : 'text-content-tertiary',
  );
  if (onToggle === undefined) return <h3 className={cn('m-0', cls)}>{body}</h3>;
  return (
    <Button
      variant="ghost"
      aria-expanded={!folded}
      onClick={onToggle}
      className={cn(
        cls,
        'justify-start self-start hover:bg-transparent hover:text-content-secondary aria-expanded:bg-transparent dark:hover:bg-transparent',
      )}
    >
      {body}
    </Button>
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
  query,
}: TasksPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TasksTab>('active');
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const groups = bySection(entries);
  const { live: connected, teamId } = useLiveData();
  const prsQuery = usePrs(teamId, undefined, connected);
  const prs = (prsQuery.data ?? []).filter(
    (pr) => projectId === null || pr.projectId === projectId,
  );
  const prOf = prByThread(prs);
  const say = (phrase: Phrase) => t(phrase.key, phrase.params);
  const row = (entry: TaskEntry) => {
    const copy: TaskRowCopy = taskRowCopy(entry, prOf.get(entry.todo.id));
    return (
      <TaskRow
        key={entry.todo.id}
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
  const active = (
    <div className="flex flex-col gap-2">
      {empty}
      {ACTIVE_SECTIONS.map((section) => {
        const n = count(section);
        if (n === 0) return null;
        const folded = section === 'resolved' ? !resolvedOpen : undefined;
        return (
          <section
            key={section}
            data-testid="tasks-section"
            data-section={section}
            className="flex flex-col"
          >
            <SectionHeader
              section={section}
              count={n}
              folded={folded}
              onToggle={section === 'resolved' ? () => setResolvedOpen((v) => !v) : undefined}
            />
            {folded !== true && (
              <>
                {section === 'needs_input' && questionRows}
                {groups[section].map(row)}
              </>
            )}
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
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 gap-1.5 self-start text-meta text-content-secondary"
        render={<Link to="/app/schedules" />}
      >
        <CalendarClock aria-hidden className="size-3.5" strokeWidth={1.75} />
        {t('管理定时')}
      </Button>
    </div>
  );
  const next =
    groups.up_next.length === 0 ? (
      <p className="m-0 px-2.5 py-2 text-meta text-content-tertiary">{t('没有待开始的任务')}</p>
    ) : (
      <section data-testid="tasks-section" data-section="up_next" className="flex flex-col">
        {groups.up_next.map(row)}
      </section>
    );
  const body = tab === 'active' ? active : next;
  return (
    <SidePanel label={t('任务')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('任务')}</SidePanelTitle>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('新任务')}
          data-testid="tasks-new"
          onClick={onNewTask}
          className="size-7.5 text-content-tertiary"
        >
          <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        </Button>
      </SidePanelHead>
      <div className="flex flex-none px-3 pt-3">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: t('当前') },
            {
              value: 'next',
              label:
                groups.up_next.length > 0
                  ? t('待开始 {n}', { n: groups.up_next.length })
                  : t('待开始'),
            },
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
