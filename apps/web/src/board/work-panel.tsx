import { PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../components/empty-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { StoneGroup, StoneTrail } from '../components/stone/stone-group.js';
import { ThreadRow } from '../components/thread/thread-row.js';
import { Button } from '../components/ui/button.js';
import type { ScheduleRecord, TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { scheduleSummary } from '../pages/schedule-summary.js';
import { needsYouThreads } from './needs-you.js';
import { relativeTime } from './rel-time.js';
import { threadCopy, threadStatus, threadTone } from './thread-copy.js';

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
  const row = (todo: TodoRecord, tone = threadTone(todo)) => (
    <ThreadRow
      key={todo.id}
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
