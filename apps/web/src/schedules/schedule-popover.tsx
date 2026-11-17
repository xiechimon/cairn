import type { ReactElement, ReactNode, RefObject } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { joinMeta, relativeTime } from '../board/rel-time.js';
import { useThreadHref } from '../board/thread-link.js';
import { useNarrow } from '../board/use-narrow.js';
import { FilterPicker } from '../components/filter-picker.js';
import { FormField } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/ui/popover.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { scrollFadeClassName, useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { scheduleWhen } from '../pages/schedule-summary.js';
import { ScheduleFields } from './schedule-fields.js';
import {
  cronHasFiveFields,
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
  place?: string;
}

const RUN_STATUS: Record<string, string> = {
  completed: '成功',
  failed: '失败',
  skipped: '跳过',
};

export function SchedulePopover({
  schedule,
  candidates = [],
  deleted = false,
  anchor,
  now,
  open,
  onOpenChange,
  trigger,
  children,
}: {
  schedule: ScheduleRecord | null;
  candidates?: readonly ScheduleCandidate[];
  deleted?: boolean;
  anchor?: RefObject<HTMLElement | null>;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
}) {
  const narrow = useNarrow();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
      <PopoverContent
        data-testid="schedule-popover"
        {...(narrow
          ? {
              anchor,
              side: 'bottom' as const,
              align: 'start' as const,
              sideOffset: ({ anchor }: { anchor: { height: number } }) => -anchor.height,
              collisionPadding: {
                top: anchor?.current?.getBoundingClientRect().top ?? 72,
                bottom: 96,
                left: 8,
                right: 8,
              },
              collisionAvoidance: { side: 'shift' as const, align: 'shift' as const },
              className:
                'max-h-(--available-height) w-(--available-width) gap-3 overflow-hidden p-3 pb-0',
            }
          : {
              side: 'left' as const,
              align: 'start' as const,
              sideOffset: 16,
              collisionPadding: { top: 60, right: 8, left: 8, bottom: 104 },
              collisionAvoidance: { side: 'flip' as const, align: 'shift' as const },
              className: 'max-h-(--available-height) w-80 gap-3 overflow-hidden p-3 pb-0',
            })}
      >
        {open && (
          <ScheduleEditor
            schedule={schedule}
            candidates={candidates}
            deleted={deleted}
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
  deleted,
  now,
  onDone,
}: {
  schedule: ScheduleRecord | null;
  candidates: readonly ScheduleCandidate[];
  deleted: boolean;
  now: number;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const threadHref = useThreadHref();
  const taskId = useId();
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
  const savable =
    !busy &&
    !deleted &&
    target !== undefined &&
    (draft.trigger !== 'custom' || cronHasFiveFields(draft.cron));
  const save = async () => {
    if (!savable || target === undefined) return;
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
      : deleted || state === 'finished' || record.nextRunAt === null || !record.enabled
        ? t('没有下一次')
        : scheduleWhen(record.nextRunAt, record.tz, now, t);
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
  const blocker =
    busy || deleted
      ? null
      : target === undefined
        ? t('先选择任务')
        : draft.trigger === 'custom' && !cronHasFiveFields(draft.cron)
          ? t('Cron 表达式有误')
          : null;
  const problem = record?.pausedReason ?? record?.lastRunError ?? null;
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollFade(bodyRef);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const reveal = (event: FocusEvent) => {
      if (event.target instanceof Element) event.target.scrollIntoView({ block: 'nearest' });
    };
    body.addEventListener('focusin', reveal);
    return () => body.removeEventListener('focusin', reveal);
  }, []);
  return (
    <>
      <PopoverTitle className="shrink-0 truncate text-ui font-medium">
        {schedule === null ? t('新建定时') : schedule.todo.title}
      </PopoverTitle>
      <div
        ref={bodyRef}
        className={`${scrollFadeClassName()} -m-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-py-5 p-1 [--scroll-fade-size:16px]`}
      >
        {deleted && (
          <p role="status" className="m-0 text-meta text-destructive">
            {t('这条定时已被删除')}
          </p>
        )}
        {schedule === null ? (
          candidates.length === 0 ? (
            <p className="m-0 text-meta text-content-secondary">
              {t('这里还没有可以定时的任务。先建一个任务，或者直接让 Coordinator 帮你建定时。')}
            </p>
          ) : (
            <FormField label={t('任务')} htmlFor={taskId}>
              <FilterPicker
                options={candidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.title,
                  ...(candidate.place === undefined
                    ? {}
                    : { detail: candidate.place, group: candidate.place }),
                }))}
                value={todoId}
                onPick={setTodoId}
                disabled={busy}
                label={t('任务')}
                placeholder={t('搜索任务或项目')}
                noun={t('任务')}
                triggerId={taskId}
                triggerClassName="w-full min-w-0 pointer-coarse:h-11"
                popupClassName="w-(--anchor-width) max-sm:w-(--anchor-width)"
                triggerContent={target === undefined ? t('选择任务') : undefined}
              />
            </FormField>
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
          <ScheduleFields value={draft} onChange={setDraft} tz={tz} disabled={busy || deleted} />
        )}
        {error !== null && (
          <p role="alert" className="m-0 break-words text-meta text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pb-3">
        {schedule !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto -ml-2.5 text-content-secondary pointer-coarse:h-11"
            render={<Link to={threadHref(schedule.todoId)} onClick={onDone} />}
          >
            {t('打开任务')}
          </Button>
        )}
        {blocker !== null && (
          <span className="ml-auto min-w-0 truncate text-meta text-content-tertiary">
            {blocker}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          className={`${blocker === null ? 'ml-auto' : ''} ${DIALOG_TEXT_BUTTON} pointer-coarse:h-11 dark:bg-(--menu-hover) dark:hover:bg-(--sidebar-press)`}
          onClick={onDone}
        >
          {deleted ? t('关闭') : t('取消')}
        </Button>
        {!deleted && (
          <Button
            size="sm"
            className="text-ui pointer-coarse:h-11 dark:disabled:bg-(--menu-hover)/50"
            disabled={!savable}
            onClick={() => void save()}
          >
            {t('保存')}
          </Button>
        )}
      </div>
    </>
  );
}
