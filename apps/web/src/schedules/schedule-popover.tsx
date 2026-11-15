import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { joinMeta, relativeTime } from '../board/rel-time.js';
import { useThreadHref } from '../board/thread-link.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/ui/popover.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ScheduleFields } from './schedule-fields.js';
import {
  scheduleBody,
  scheduleDraft,
  schedulePauseReason,
  scheduleViewState,
  toWireSchedule,
} from './schedule-model.js';

export interface ScheduleCandidate {
  id: string;
  title: string;
  projectId: string;
}

const RUN_STATUS: Record<string, string> = {
  completed: '成功',
  failed: '失败',
  skipped: '跳过',
};

export function SchedulePopover({
  schedule,
  candidates = [],
  now,
  open,
  onOpenChange,
  trigger,
  children,
}: {
  schedule: ScheduleRecord | null;
  candidates?: readonly ScheduleCandidate[];
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverContent
        data-testid="schedule-popover"
        side="bottom"
        align="start"
        collisionPadding={8}
        className="max-h-(--available-height) w-80 gap-3 overflow-y-auto p-3"
      >
        {open && (
          <ScheduleEditor
            schedule={schedule}
            candidates={candidates}
            now={now}
            onDone={() => onOpenChange(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ScheduleEditor({
  schedule,
  candidates,
  now,
  onDone,
}: {
  schedule: ScheduleRecord | null;
  candidates: readonly ScheduleCandidate[];
  now: number;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const threadHref = useThreadHref();
  const tz = schedule?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const record = schedule === null ? null : toWireSchedule(schedule);
  const [draft, setDraft] = useState(() => scheduleDraft(record, now, tz));
  const [todoId, setTodoId] = useState(schedule?.todoId ?? candidates[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const target =
    schedule === null
      ? candidates.find((candidate) => candidate.id === todoId)
      : { id: schedule.todoId, title: schedule.todo.title, projectId: schedule.projectId };
  const busy = mutations.createSchedule.isPending;
  const save = async () => {
    if (target === undefined) return;
    if (!live) {
      blockDemoWrite();
      onDone();
      return;
    }
    setError(null);
    try {
      await mutations.createSchedule.mutateAsync(
        scheduleBody(
          draft,
          {
            todoId: target.id,
            projectId: target.projectId,
            tz,
            enabled: record?.enabled ?? true,
          },
          now,
        ),
      );
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? t(failure.message) : t('定时没能保存，请重试。'));
    }
  };
  const state = record === null ? null : scheduleViewState(record);
  const nextRun =
    record === null
      ? null
      : state === 'finished' || record.nextRunAt === null || !record.enabled
        ? t('没有下一次')
        : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
            timeZone: record.tz,
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(record.nextRunAt);
  const lastRun =
    record === null
      ? null
      : record.lastRunAt === null
        ? t('还没运行过')
        : joinMeta([
            relativeTime(record.lastRunAt, now, t),
            record.lastRunStatus === null
              ? null
              : t(RUN_STATUS[record.lastRunStatus] ?? record.lastRunStatus),
          ]);
  const problem = record?.pausedReason ?? record?.lastRunError ?? null;
  return (
    <>
      <PopoverTitle className="truncate text-ui font-medium">
        {schedule === null ? t('新建定时') : schedule.todo.title}
      </PopoverTitle>
      {schedule === null ? (
        candidates.length === 0 ? (
          <p className="m-0 text-meta text-content-secondary">
            {t('这里还没有可以定时的任务。先建一个任务，或者直接让 Coordinator 帮你建定时。')}
          </p>
        ) : (
          <Select
            value={todoId}
            onValueChange={(value) => {
              if (value !== null) setTodoId(value);
            }}
            disabled={busy}
          >
            <SelectTrigger aria-label={t('任务')} className="w-full min-w-0">
              <SelectValue>
                <span className="truncate">{target?.title ?? t('选择任务')}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent aria-label={t('任务')}>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : (
        <dl data-testid="schedule-popover-runs" className="m-0 grid grid-cols-2 gap-2 text-meta">
          <div>
            <dt className="text-content-tertiary">{t('下次运行')}</dt>
            <dd className="m-0 text-foreground">{nextRun}</dd>
          </div>
          <div>
            <dt className="text-content-tertiary">{t('上次运行')}</dt>
            <dd className="m-0 text-foreground">{lastRun}</dd>
          </div>
          {problem !== null && (
            <dd className="col-span-2 m-0 break-words text-content-secondary" title={problem}>
              {schedulePauseReason(problem, t)}
            </dd>
          )}
        </dl>
      )}
      {(schedule !== null || candidates.length > 0) && (
        <ScheduleFields value={draft} onChange={setDraft} tz={tz} disabled={busy} />
      )}
      {error !== null && (
        <p role="alert" className="m-0 break-words text-meta text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        {schedule !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-content-secondary"
            render={<Link to={threadHref(schedule.todoId)} onClick={onDone} />}
          >
            {t('打开任务')}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
          {t('取消')}
        </Button>
        <Button size="sm" disabled={busy || target === undefined} onClick={() => void save()}>
          {t('保存')}
        </Button>
      </div>
    </>
  );
}
