import { useState } from 'react';
import { useStopBackgroundTask } from '../api/hooks.js';
import { formatLiveElapsed, useLiveSeconds } from '../components/chat/live-row.js';
import {
  TraceCard,
  TraceCollapse,
  TraceFailTag,
  TraceRowButton,
} from '../components/chat/trace-parts.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import type { BackgroundTaskView, TranscriptItem } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';
import { WorkTrace } from './work-trace.js';

const SETTLED_LABEL = {
  done: '已完成',
  stopped: '已停止',
  orphaned: '已中断',
} as const;

const NO_ENTERING = new Set<string>();

function BackgroundTaskRow({
  task,
  buildId,
  t,
}: {
  task: BackgroundTaskView;
  buildId: string;
  t: TFunc;
}) {
  const [open, setOpen] = useState(false);
  const stop = useStopBackgroundTask();
  const running = task.status === 'running';
  const elapsed = formatLiveElapsed(useLiveSeconds(running ? task.startedAt : null));
  const hasDetail = (task.prompt ?? '').trim() !== '' || task.steps.length > 0;
  return (
    <li data-testid="bg-task" data-status={task.status} className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-1 pr-1">
        <TraceRowButton
          className="min-w-0 flex-1"
          running={running}
          expandable={hasDetail}
          open={open}
          {...(hasDetail ? { onClick: () => setOpen((value) => !value) } : {})}
          verb={
            <span className="flex items-center gap-2">
              {running && (
                <span
                  aria-hidden="true"
                  data-testid="bg-task-running-dot"
                  className="block size-1.5 rounded-full bg-running"
                />
              )}
              {t(task.type === 'agent' ? '子 agent' : '命令')}
            </span>
          }
          target={task.description}
          trailing={
            <>
              {task.toolUses !== undefined && task.toolUses > 0 && (
                <span className="text-caption">{t('{n} 次工具调用', { n: task.toolUses })}</span>
              )}
              {running && elapsed !== '' && <span className="text-caption">{elapsed}</span>}
              {task.status === 'failed' && <TraceFailTag>{t('失败')}</TraceFailTag>}
              {task.status !== 'running' && task.status !== 'failed' && (
                <span className="text-caption">{t(SETTLED_LABEL[task.status])}</span>
              )}
            </>
          }
        />
        {running && (
          <IconTooltip
            label={t('停止这个后台任务')}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 flex-none text-(--text-tertiary) hover:text-(--foreground)"
                data-testid="bg-task-stop"
                disabled={stop.isPending}
                onClick={() => stop.mutate({ buildId, taskId: task.taskId })}
              />
            }
          >
            <span className="size-2.5 rounded-(--cds-radius-xs) bg-current" />
          </IconTooltip>
        )}
      </div>
      {hasDetail && (
        <TraceCollapse open={open}>
          <div className="flex flex-col gap-2 px-3 pt-1 pb-3" data-testid="bg-task-detail">
            {(task.prompt ?? '').trim() !== '' && (
              <p className="m-0 text-meta leading-5 whitespace-pre-wrap text-(--text-secondary)">
                {task.prompt}
              </p>
            )}
            {task.steps.length > 0 && (
              <WorkTrace
                item={{ kind: 'work', id: `bg-${task.taskId}`, steps: task.steps }}
                defaultExpanded
                entering={NO_ENTERING}
                t={t}
              />
            )}
          </div>
        </TraceCollapse>
      )}
    </li>
  );
}

export function BackgroundTasks({
  item,
  t,
}: {
  item: Extract<TranscriptItem, { kind: 'bg-tasks' }>;
  t: TFunc;
}) {
  return (
    <section className="my-2 agent-measure" data-testid="bg-tasks" aria-label={t('后台任务')}>
      <div className="text-meta leading-6 text-(--text-tertiary)">{t('后台任务')}</div>
      <TraceCard>
        <ul className="m-0 flex list-none flex-col divide-y divide-(--border) p-0">
          {item.tasks.map((task) => (
            <BackgroundTaskRow key={task.taskId} task={task} buildId={item.buildId} t={t} />
          ))}
        </ul>
      </TraceCard>
    </section>
  );
}
