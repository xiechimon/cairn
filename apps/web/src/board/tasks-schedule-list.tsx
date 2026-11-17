import { ChevronRight, Clock, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSchedules } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { QueryBoundary } from '../components/query-state.js';
import { Button } from '../components/ui/button.js';
import { withCreatedSchedules, withoutDeleted } from '../fixtures/deletions.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import {
  scheduleCadence,
  scheduleNext,
  scheduleSummary,
  scheduleUnnamedCron,
} from '../pages/schedule-summary.js';
import { scheduleEnded, schedulePauseReason } from '../schedules/schedule-model.js';
import { type ScheduleCandidate, SchedulePopover } from '../schedules/schedule-popover.js';
import { ScheduleRowMenu } from './tasks-schedule-menu.js';

function byNextRun(a: ScheduleRecord, b: ScheduleRecord): number {
  const key = (row: ScheduleRecord) =>
    row.enabled === false || !row.nextRunAt ? Number.POSITIVE_INFINITY : row.nextRunAt;
  return key(a) - key(b);
}

const ROW_ICON = 'flex size-7 flex-none items-center justify-center';

export function TasksScheduleList({
  projectId,
  now,
  candidates,
}: {
  projectId: string | null;
  now: number;
  candidates: readonly ScheduleCandidate[];
}) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const { live } = useLiveData();
  const query = useSchedules(live);
  const [editing, setEditing] = useState<ScheduleRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [endedOpen, setEndedOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fixture = resolveScenario(searchParams);
  const listed = withoutDeleted(
    live
      ? (query.data ?? []).map((row) => ({ ...row, at: row.at ?? now }))
      : withCreatedSchedules(fixture.schedules ?? []),
  ).filter((row) => projectId === null || row.projectId === projectId);
  const scheduled = new Set(listed.map((row) => row.todoId));
  const editingDeleted = editing !== null && !listed.some((row) => row.todoId === editing.todoId);
  const rows = (editingDeleted ? [...listed, editing] : listed).sort(byNextRun);
  const free = candidates.filter((candidate) => !scheduled.has(candidate.id));
  const current = rows.filter((row) => !scheduleEnded(row));
  const ended = rows.filter(scheduleEnded);
  const newSchedule = (empty: boolean) => (
    <SchedulePopover
      schedule={null}
      candidates={free}
      anchor={empty ? undefined : listRef}
      now={now}
      open={creating}
      onOpenChange={setCreating}
      trigger={
        empty ? (
          <Button
            variant="secondary"
            size="sm"
            data-testid="schedule-new"
            title={t('也可以直接告诉 Coordinator 某个任务要多久重跑一次，它会替你写好规则')}
          />
        ) : (
          <Button
            variant="ghost"
            data-testid="schedule-new"
            className="h-auto w-full justify-start gap-4 rounded-(--radius-tile) py-2 pl-2.5 text-left font-normal text-content-secondary"
          />
        )
      }
    >
      {empty ? null : (
        <span className={ROW_ICON}>
          <Plus aria-hidden className="size-4 text-content-tertiary" strokeWidth={1.75} />
        </span>
      )}
      {t('新建定时')}
    </SchedulePopover>
  );
  const row = (schedule: ScheduleRecord) => {
    const deletedHere = editingDeleted && editing.todoId === schedule.todoId;
    const reason = schedule.enabled === false ? (schedule.pausedReason ?? null) : null;
    const cron = scheduleUnnamedCron(schedule, t);
    const cadence =
      cron === null ? (
        scheduleCadence(schedule, t)
      ) : (
        <>
          {t('自定义')} <code className="font-mono">{cron}</code>
        </>
      );
    const status = deletedHere ? (
      t('已删除')
    ) : reason !== null ? (
      schedulePauseReason(reason, t)
    ) : scheduleEnded(schedule) ? (
      t(schedule.lastRunAt ? '已运行' : '停止前没有运行')
    ) : schedule.enabled === false ? (
      <>
        {cadence} · {t('已暂停')}
      </>
    ) : cron === null ? (
      scheduleSummary(schedule, now, t)
    ) : (
      <>
        {cadence} · {scheduleNext(schedule, now, t)}
      </>
    );
    return (
      <div
        key={schedule.id}
        data-slot="schedule-row-frame"
        className="group/task relative rounded-(--radius-tile) hover:bg-(--menu-hover) has-aria-expanded:bg-(--menu-hover)"
      >
        <SchedulePopover
          schedule={schedule}
          deleted={deletedHere}
          anchor={listRef}
          now={now}
          open={editing?.todoId === schedule.todoId}
          onOpenChange={(open) => setEditing(open ? schedule : null)}
          trigger={
            <Button
              variant="ghost"
              data-slot="schedule-row"
              className="h-auto w-full items-center justify-start gap-4 rounded-(--radius-tile) py-2 pr-11 pl-2.5 text-left font-normal whitespace-normal hover:bg-transparent pointer-coarse:pr-12 dark:hover:bg-transparent"
            />
          }
        >
          <span className={ROW_ICON}>
            <Clock aria-hidden className="size-4 text-content-tertiary" strokeWidth={1.75} />
          </span>
          <span className="flex min-h-7 min-w-0 flex-1 flex-col justify-center">
            <span className="truncate text-ui leading-5 text-foreground">
              {schedule.todo.title}
            </span>
            <span
              className="truncate text-meta leading-4.5 text-content-tertiary"
              title={reason ?? undefined}
            >
              {status}
            </span>
          </span>
        </SchedulePopover>
        {!deletedHere && (
          <div
            data-slot="schedule-row-menu"
            className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-focus-within/task:opacity-100 group-hover/task:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:right-0 pointer-coarse:opacity-100"
          >
            <ScheduleRowMenu schedule={schedule} now={now} onEdit={() => setEditing(schedule)} />
          </div>
        )}
      </div>
    );
  };
  return (
    <QueryBoundary
      query={live ? query : undefined}
      isEmpty={rows.length === 0}
      loadingLabel={t('正在加载定时')}
      errorTitle={t('定时没能加载')}
      empty={
        <div className="flex flex-col items-start gap-3 px-2.5 py-2">
          <p data-testid="tasks-schedules-empty" className="m-0 text-ui text-content-tertiary">
            {t('还没有定时任务')}
          </p>
          {newSchedule(true)}
        </div>
      }
    >
      <div ref={listRef} className="flex flex-col">
        <section
          data-testid="tasks-section"
          data-section="scheduled"
          className="flex flex-col gap-0.5"
        >
          {current.map(row)}
          {newSchedule(false)}
        </section>
        {ended.length > 0 && (
          <section data-testid="schedules-ended" className="mt-2 flex flex-col gap-0.5">
            <Button
              variant="ghost"
              aria-expanded={endedOpen}
              onClick={() => setEndedOpen((open) => !open)}
              className="h-8 justify-start gap-4 rounded-(--radius-tile) px-2.5 text-ui font-normal text-foreground aria-expanded:bg-transparent pointer-coarse:h-11 dark:aria-expanded:bg-transparent"
            >
              <span className={ROW_ICON}>
                <ChevronRight
                  aria-hidden
                  className={`size-4 text-content-tertiary transition-transform ${endedOpen ? 'rotate-90' : ''}`}
                />
              </span>
              <span className="flex items-baseline gap-2">
                {t('已结束')}
                <span className="text-content-tertiary tabular-nums">{ended.length}</span>
              </span>
            </Button>
            {endedOpen && ended.map(row)}
          </section>
        )}
      </div>
    </QueryBoundary>
  );
}
