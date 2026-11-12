import { Clock } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSchedules } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { QueryBoundary } from '../components/query-state.js';
import { Button } from '../components/ui/button.js';
import { withCreatedSchedules, withoutDeleted } from '../fixtures/deletions.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { scheduleSummary } from '../pages/schedule-summary.js';
import { ScheduleDetailController } from '../schedules/schedule-detail-dialog.js';
import { ScheduleRowMenu } from './tasks-schedule-menu.js';

function byNextRun(a: ScheduleRecord, b: ScheduleRecord): number {
  const key = (row: ScheduleRecord) =>
    row.enabled === false || !row.nextRunAt ? Number.POSITIVE_INFINITY : row.nextRunAt;
  return key(a) - key(b);
}

export function TasksScheduleList({ projectId, now }: { projectId: string | null; now: number }) {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const { live } = useLiveData();
  const query = useSchedules(live);
  const [selected, setSelected] = useState<ScheduleRecord | null>(null);
  const fixture = resolveScenario(searchParams);
  const rows = withoutDeleted(
    live
      ? (query.data ?? []).map((row) => ({ ...row, at: row.at ?? now }))
      : withCreatedSchedules(fixture.schedules ?? []),
  )
    .filter((row) => projectId === null || row.projectId === projectId)
    .sort(byNextRun);
  return (
    <>
      <QueryBoundary
        query={live ? query : undefined}
        isEmpty={rows.length === 0}
        loadingLabel={t('正在加载定时')}
        errorTitle={t('定时没能加载')}
        empty={
          <p
            data-testid="tasks-schedules-empty"
            className="m-0 px-2.5 py-2 text-ui text-content-tertiary"
          >
            {t('还没有定时任务')}
          </p>
        }
      >
        <section
          data-testid="tasks-section"
          data-section="scheduled"
          className="flex flex-col gap-0.5"
        >
          {rows.map((row) => (
            <div key={row.id} data-slot="schedule-row-frame" className="group/task relative">
              <Button
                variant="ghost"
                data-slot="schedule-row"
                onClick={() => setSelected(row)}
                className="h-auto w-full items-start justify-start gap-4 rounded-(--radius-tile) px-2.5 py-2 text-left font-normal whitespace-normal hover:bg-(--menu-hover) pointer-coarse:pr-12 dark:hover:bg-(--menu-hover)"
              >
                <span className="flex size-7 flex-none items-center justify-center rounded-(--radius-control) bg-(--hover-1)">
                  <Clock aria-hidden className="size-4 text-content-tertiary" strokeWidth={1.75} />
                </span>
                <span className="flex min-h-7 min-w-0 flex-1 flex-col justify-center">
                  <span className="truncate text-ui leading-5 text-foreground">
                    {row.todo.title}
                  </span>
                  <span className="truncate text-meta leading-4.5 text-content-tertiary">
                    {row.enabled === false
                      ? (row.pausedReason ?? t('已暂停'))
                      : scheduleSummary(row, now, t)}
                  </span>
                </span>
              </Button>
              <div
                data-slot="schedule-row-menu"
                className="absolute top-3 right-2 opacity-0 group-focus-within/task:opacity-100 group-hover/task:opacity-100 has-aria-expanded:opacity-100 pointer-coarse:top-0 pointer-coarse:right-0 pointer-coarse:opacity-100"
              >
                <ScheduleRowMenu schedule={row} now={now} onOpenDetail={() => setSelected(row)} />
              </div>
            </div>
          ))}
        </section>
      </QueryBoundary>
      <ScheduleDetailController schedule={selected} now={now} onClose={() => setSelected(null)} />
    </>
  );
}
