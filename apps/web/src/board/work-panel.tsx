import { PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { usePrs } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import { PrList } from '../components/thread/pr-list.js';
import { prByThread } from '../components/thread/pr-panel-model.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import type { ScheduleRecord, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { scheduleSummary } from '../pages/schedule-summary.js';
import { needsYouThreads } from './needs-you.js';
import { relativeTime } from './rel-time.js';
import { THREAD_PARAM, threadCopy, threadStatus, threadTone, VIEW_PARAM } from './thread-copy.js';

export type WorkPane = 'tasks' | 'made' | 'machines';

export const PANE_PARAM = 'pane';

export function paneOf(value: string | null): WorkPane | null {
  return value === 'tasks' || value === 'made' || value === 'machines' ? value : null;
}

const live = (todo: TodoRecord) => todo.archivedAt == null;

interface WorkPanelProps {
  pane: Exclude<WorkPane, 'machines'>;
  todos: readonly TodoRecord[];
  schedules: readonly ScheduleRecord[];
  now: number;
  onClose: () => void;
  onOpenThread: (id: string) => void;
}

export function WorkPanel({ pane, todos, schedules, now, onClose, onOpenThread }: WorkPanelProps) {
  const { t } = useI18n();
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const fold = (id: string) => ({
    collapsed: folded[id] === true,
    onCollapsedChange: (next: boolean) => setFolded((prev) => ({ ...prev, [id]: next })),
  });
  const title = pane === 'tasks' ? t('任务') : t('成果');
  const { live: connected, teamId } = useLiveData();
  const prs = usePrs(teamId, undefined, connected);
  const scopedIds = new Set(todos.map((todo) => todo.id));
  const scopedPrs = (prs.data ?? []).filter((pr) => scopedIds.has(pr.threadId));
  const prOf = prByThread(scopedPrs);
  const [, setSearchParams] = useSearchParams();
  const row = (todo: TodoRecord, tone = threadTone(todo)) => (
    <ThreadRow
      key={todo.id}
      {...(prOf.has(todo.id)
        ? { prLink: { number: prOf.get(todo.id)?.number ?? 0, url: prOf.get(todo.id)?.url ?? '' } }
        : {})}
      title={todo.title}
      tone={tone}
      reason={t(threadCopy(todo).reason)}
      age={relativeTime(todo.phaseAt, now, t)}
      onOpen={() => onOpenThread(todo.id)}
    />
  );
  const needsYou = needsYouThreads(todos);
  const running = todos.filter((todo) => threadStatus(todo) === 'running' && live(todo));
  const active = new Set([...needsYou, ...running].map((todo) => todo.id));
  const waitingSchedules = schedules.filter((schedule) => !active.has(schedule.todoId));
  const scheduled = new Set(waitingSchedules.map((schedule) => schedule.todoId));
  const idle = todos.filter(
    (todo) => threadStatus(todo) === 'idle' && live(todo) && !scheduled.has(todo.id),
  );

  const made = todos
    .filter((todo) => threadStatus(todo) === 'done' && live(todo))
    .sort((a, b) => b.phaseAt - a.phaseAt);

  return (
    <SidePanel label={title} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{title}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-3 pb-4">
        {pane === 'tasks' ? (
          <StoneTrail className="px-0">
            <StoneGroup
              tone="waiting"
              label={t('等你处理')}
              {...fold('needs-you')}
              count={needsYou.length}
              emptyHint={t('没有等你的事')}
            >
              {needsYou.map((todo) => row(todo))}
            </StoneGroup>
            <StoneGroup
              tone="working"
              label={t('在进行')}
              {...fold('running')}
              count={running.length}
              emptyHint={t('没有在进行的任务')}
            >
              {running.map((todo) => row(todo, 'working'))}
            </StoneGroup>
            <StoneGroup
              tone="idle"
              label={t('空闲')}
              {...fold('idle')}
              count={idle.length + waitingSchedules.length}
              emptyHint={t('没有空闲的任务')}
            >
              {idle.map((todo) => row(todo, 'idle'))}
              {waitingSchedules.map((schedule) => (
                <ThreadRow
                  key={schedule.id}
                  title={`#${schedule.todo.seqNum} ${schedule.todo.title}`}
                  tone="idle"
                  reason={scheduleSummary(schedule, now, t)}
                  onOpen={() => onOpenThread(schedule.todoId)}
                />
              ))}
            </StoneGroup>
            {connected && (
              <section data-testid="work-prs" className="flex flex-col pt-1">
                <h3 className="m-0 flex h-8 items-center gap-2 px-2.5 text-meta font-medium text-content-secondary">
                  {t('拉取请求')}
                  <span className="font-normal text-content-tertiary tabular-nums">
                    {scopedPrs.length}
                  </span>
                </h3>
                {prs.status === 'error' ? (
                  <p className="m-0 flex items-center gap-2 pb-2 pl-2.5 text-meta text-content-tertiary">
                    {t('PR 列表加载失败，稍后会自动重试。')}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6.5 text-meta"
                      onClick={() => void prs.refetch()}
                    >
                      {t('重试')}
                    </Button>
                  </p>
                ) : scopedPrs.length === 0 ? (
                  <p className="m-0 pb-2 pl-2.5 text-meta text-content-tertiary">
                    {t('任务开出 PR 后会列在这里。')}
                  </p>
                ) : (
                  <PrList
                    rows={scopedPrs}
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
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 self-start text-meta text-content-secondary"
              render={<Link to="/app/schedules" />}
            >
              {t('管理定时')}
            </Button>
          </StoneTrail>
        ) : made.length === 0 ? (
          <EmptyState
            testId="made-empty"
            icon={PackageCheck}
            title={t('还没有完成的工作')}
            description={t('任务合并完成后会出现在这里。')}
            className="mt-[10vh]"
          />
        ) : (
          <StoneTrail className="px-0">{made.map((todo) => row(todo, 'resolved'))}</StoneTrail>
        )}
      </div>
    </SidePanel>
  );
}
