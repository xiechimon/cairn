import type { CreateScheduleBody, ScheduleRecord } from '@cairn/shared';
import { ExternalLink, Play, Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations, useSchedules } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { joinMeta, relativeTime } from '../board/rel-time.js';
import { useThreadHref } from '../board/thread-link.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { StatusChip } from '../components/ui/status-chip.js';
import { Switch } from '../components/ui/switch.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ScheduleRecord as DisplaySchedule } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { ScheduleFields } from './schedule-fields.js';
import { scheduleBody, scheduleDraft, scheduleViewState } from './schedule-model.js';

export function ScheduleDetailController({
  schedule,
  now,
  onClose,
}: {
  schedule: DisplaySchedule | null;
  now: number;
  onClose: () => void;
}) {
  const { live } = useLiveData();
  const { t } = useI18n();
  if (schedule === null) return null;
  if (live)
    return <LiveScheduleDetail key={schedule.id} schedule={schedule} now={now} onClose={onClose} />;
  const unavailable = async () => {
    blockDemoWrite();
    throw new Error(t('Schedule changes are unavailable in this preview.'));
  };
  const record: ScheduleRecord = {
    ...schedule,
    cron: schedule.cron ?? null,
    prompt: schedule.prompt ?? '',
    enabled: schedule.enabled ?? true,
    pausedReason: schedule.pausedReason ?? null,
    lastRunAt: schedule.lastRunAt ?? null,
    lastRunStatus: schedule.lastRunStatus ?? null,
  };
  return (
    <ScheduleDetailDialog
      key={record.id}
      schedule={record}
      now={now}
      onClose={onClose}
      onSave={unavailable}
      onEnabled={unavailable}
      onRun={unavailable}
      onDelete={unavailable}
    />
  );
}

function LiveScheduleDetail({
  schedule,
  now,
  onClose,
}: {
  schedule: DisplaySchedule;
  now: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const schedules = useSchedules(true);
  const mutations = useApiMutations(teamId);
  const record = schedules.data?.find((row) => row.id === schedule.id);
  if (record === undefined)
    return (
      <DialogShell title={schedule.todo.title} open onClose={onClose}>
        <div role="status" className="flex flex-col gap-3 text-ui text-content-secondary">
          {schedules.isError
            ? t('The scheduled task could not be loaded.')
            : schedules.isPending
              ? t('Loading scheduled task…')
              : t('This scheduled task is no longer available.')}
          {schedules.isError && (
            <Button
              variant="outline"
              disabled={schedules.isFetching}
              onClick={() => void schedules.refetch()}
            >
              {t('重试')}
            </Button>
          )}
        </div>
      </DialogShell>
    );
  return (
    <ScheduleDetailDialog
      key={record.id}
      schedule={record}
      now={now}
      onClose={onClose}
      onSave={async (body) => {
        await mutations.createSchedule.mutateAsync(body);
      }}
      onEnabled={async (enabled) => {
        await mutations.patchSchedule.mutateAsync({ id: record.id, body: { enabled } });
      }}
      onRun={async () => {
        await mutations.runSchedule.mutateAsync(record.id);
      }}
      onDelete={async () => {
        await mutations.deleteSchedule.mutateAsync(record.id);
      }}
    />
  );
}

export function ScheduleDetailDialog({
  schedule,
  now,
  onClose: dismiss,
  onSave,
  onEnabled,
  onRun,
  onDelete,
}: {
  schedule: ScheduleRecord;
  now: number;
  onClose: () => void;
  onSave: (body: CreateScheduleBody) => Promise<void>;
  onEnabled: (enabled: boolean) => Promise<void>;
  onRun: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const activeSwitchId = useId();
  const origin = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const onClose = () => {
    dismiss();
    requestAnimationFrame(() => {
      if (origin.current instanceof HTMLElement && origin.current.isConnected)
        origin.current.focus();
    });
  };
  const threadHref = useThreadHref();
  const [draft, setDraft] = useState(() => scheduleDraft(schedule, now));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const state = scheduleViewState(schedule);
  const labels = {
    active: 'Active',
    paused: 'Paused',
    disabled: 'Auto-disabled',
    finished: 'Finished one-time schedule',
  };
  const running = ['queued', 'planning', 'building'].includes(schedule.todo.phase);
  const queued = schedule.enabled && schedule.nextRunAt !== null && schedule.nextRunAt <= now;
  let valid = true;
  try {
    scheduleBody(draft, schedule, now);
  } catch {
    valid = false;
  }
  const perform = async (action: () => Promise<void>, success?: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      success?.();
    } catch (failure) {
      setError(failure instanceof Error ? t(failure.message) : t('Schedule update failed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const updateEnabled = (enabled: boolean) => {
    if (state === 'finished') return;
    void perform(() => onEnabled(enabled));
  };
  return (
    <>
      <DialogShell
        title={schedule.todo.title}
        subtitle={t('Scheduled task in {project}, #{number}', {
          project: schedule.todo.projectName,
          number: schedule.todo.seqNum,
        })}
        open
        onClose={busy ? () => undefined : onClose}
        size="m"
        footer={
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              className="mr-auto text-content-secondary"
              render={<Link to={threadHref(schedule.todoId)} onClick={dismiss} />}
            >
              <ExternalLink data-icon="inline-start" />
              {t('Open thread')}
            </Button>
            <Button
              disabled={busy || !valid}
              onClick={() =>
                void perform(async () => {
                  await onSave(scheduleBody(draft, schedule, now));
                }, onClose)
              }
            >
              {t('保存')}
            </Button>
          </div>
        }
      >
        <div data-testid="schedule-detail-body" className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2">
            <StatusChip
              tone={state === 'disabled' ? 'failed' : state === 'active' ? 'done' : 'idle'}
            >
              {t(labels[state])}
            </StatusChip>
            <span className="text-meta text-content-tertiary">{schedule.tz}</span>
          </div>
          {schedule.pausedReason !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 min-w-0 flex-1 break-words text-meta text-content-secondary">
                {schedule.pausedReason}
              </p>
              {state === 'disabled' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => updateEnabled(true)}
                >
                  {t('Re-enable')}
                </Button>
              )}
            </div>
          )}
          <dl className="m-0 grid grid-cols-2 gap-3 text-meta max-[400px]:grid-cols-1">
            <div>
              <dt className="text-content-tertiary">{t('Next run')}</dt>
              <dd className="m-0 mt-1 text-foreground">
                {state === 'finished'
                  ? t('No upcoming runs')
                  : schedule.nextRunAt === null
                    ? t(schedule.enabled ? 'Next run unavailable' : 'None while paused')
                    : !schedule.enabled
                      ? t('None while paused')
                      : queued
                        ? t('Run queued')
                        : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
                            timeZone: schedule.tz,
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(schedule.nextRunAt)}
              </dd>
            </div>
            <div>
              <dt className="text-content-tertiary">{t('Last run')}</dt>
              <dd className="m-0 mt-1 text-foreground">
                {schedule.lastRunAt === null
                  ? t('Not run yet')
                  : joinMeta([
                      relativeTime(schedule.lastRunAt, now, t),
                      schedule.lastRunStatus ?? '—',
                    ])}
              </dd>
            </div>
          </dl>
          {schedule.lastRunError != null && (
            <p className="m-0 break-words text-meta text-destructive">{schedule.lastRunError}</p>
          )}
          <ScheduleFields value={draft} onChange={setDraft} tz={schedule.tz} disabled={busy} />
          <p className="m-0 text-caption text-content-tertiary">
            {t('Saving replaces this schedule and resets its run history.')}
          </p>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !schedule.enabled || running || queued}
              onClick={() => void perform(onRun, () => setNotice(t('Run queued')))}
            >
              <Play data-icon="inline-start" />
              {t('Run now')}
            </Button>
            {state !== 'disabled' && (
              <label
                htmlFor={activeSwitchId}
                className="flex items-center gap-2 text-meta text-foreground"
              >
                <Switch
                  id={activeSwitchId}
                  size="sm"
                  checked={state === 'active'}
                  disabled={busy || state === 'finished'}
                  onCheckedChange={updateEnabled}
                />
                {t(
                  state === 'finished'
                    ? 'Finished one-time schedule'
                    : schedule.enabled
                      ? 'Active'
                      : 'Paused',
                )}
              </label>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 data-icon="inline-start" />
              {t('删除')}
            </Button>
          </div>
          {error !== null && (
            <p role="alert" className="m-0 break-words text-meta text-destructive">
              {error}
            </p>
          )}
          {notice !== null && (
            <p role="status" className="m-0 text-meta text-content-secondary">
              {notice}
            </p>
          )}
        </div>
      </DialogShell>
      <DeleteConfirm
        open={confirmDelete}
        title={t('确定删除该定时？此操作不可撤销。')}
        summary={
          <div className="flex min-w-0 flex-col gap-2 whitespace-normal">
            <span className="truncate">{schedule.todo.title}</span>
            {error !== null && (
              <p role="alert" className="m-0 break-words text-meta text-destructive">
                {error}
              </p>
            )}
          </div>
        }
        ariaLabel={t('删除定时')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          void perform(onDelete, () => {
            setConfirmDelete(false);
            onClose();
          })
        }
      />
    </>
  );
}
