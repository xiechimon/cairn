import type { ScheduleRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Pause, Timer, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApiMutations, useSchedules } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/ui/popover.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  automationCadence,
  automationFinished,
  automationLastRunAge,
  automationNextRun,
  automationsForThread,
} from './thread-automation-model.js';

export function ThreadAutomations({ todo, now }: { todo: TodoRecord; now: number }) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const schedules = useSchedules(live);
  const mutations = useApiMutations(teamId);
  if (!live) return null;
  const own = automationsForThread(schedules.data ?? [], todo.id);
  if (schedules.isError && own.length === 0) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('Retry loading automations')}
        data-testid="automation-load-error"
        disabled={schedules.isFetching}
        onClick={() => void schedules.refetch()}
      >
        <TriangleAlert />
      </Button>
    );
  }
  if (schedules.data === undefined) {
    return (
      <Button
        variant="ghost"
        size="icon-xs"
        disabled
        aria-label={t('Loading automations…')}
        data-testid="automation-loading"
      >
        <Timer />
      </Button>
    );
  }
  if (own.length === 0) return null;
  return (
    <ThreadAutomationBadge
      key={todo.id}
      schedules={own}
      now={now}
      liveClock
      allowEnable={todo.archivedAt == null && todo.phase !== 'closed'}
      loadFailed={schedules.isError}
      onRetry={() => void schedules.refetch()}
      onEnabled={async (id, enabled) => {
        await mutations.patchSchedule.mutateAsync({ id, body: { enabled } });
      }}
      onDelete={async (id) => {
        await mutations.deleteSchedule.mutateAsync(id);
      }}
    />
  );
}

export interface ThreadAutomationBadgeProps {
  schedules: readonly ScheduleRecord[];
  now: number;
  liveClock?: boolean;
  allowEnable?: boolean;
  loadFailed?: boolean;
  onRetry?: () => void;
  onEnabled: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  defaultOpen?: boolean;
}

export function ThreadAutomationBadge({
  schedules,
  now,
  liveClock = false,
  allowEnable = true,
  loadFailed = false,
  onRetry,
  onEnabled,
  onDelete,
  defaultOpen = false,
}: ThreadAutomationBadgeProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [clockNow, setClockNow] = useState(now);
  useEffect(() => {
    if (!liveClock || !open) return;
    const refresh = () => setClockNow(Date.now());
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(interval);
  }, [liveClock, open]);
  const displayNow = liveClock ? clockNow : now;
  const muted = schedules.every((schedule) => !schedule.enabled || automationFinished(schedule));
  if (schedules.length === 0) return null;
  const Icon = muted ? Pause : Timer;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="secondary"
            size="xs"
            data-testid="automation-badge"
            aria-label={t('{n} {n#automation|automations}', { n: schedules.length })}
            className={cn(
              'h-5 gap-1 rounded-full px-1.5 text-caption font-normal tabular-nums',
              muted && 'text-content-tertiary',
            )}
          />
        }
      >
        <Icon data-icon="inline-start" />
        <span>{schedules.length}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        data-testid="automation-popover"
        className="max-h-120 w-80 max-w-(--available-width) overflow-y-auto p-3"
      >
        <PopoverTitle className="sr-only">{t('Automations')}</PopoverTitle>
        {loadFailed && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 text-meta text-destructive"
          >
            <span>{t('Automations could not refresh')}</span>
            <Button variant="outline" size="xs" onClick={onRetry}>
              {t('Retry')}
            </Button>
          </div>
        )}
        {schedules.map((schedule) => (
          <AutomationItem
            key={schedule.id}
            schedule={schedule}
            now={displayNow}
            allowEnable={allowEnable}
            onEnabled={onEnabled}
            onDelete={onDelete}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function AutomationItem({
  schedule,
  now,
  allowEnable,
  onEnabled,
  onDelete,
}: {
  schedule: ScheduleRecord;
  now: number;
  allowEnable: boolean;
  onEnabled: ThreadAutomationBadgeProps['onEnabled'];
  onDelete: ThreadAutomationBadgeProps['onDelete'];
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = automationFinished(schedule);
  const change = async (action: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Automation update failed'));
    } finally {
      setBusy(false);
    }
  };
  const lastRun =
    schedule.lastRunAt === null
      ? null
      : t('Last run {age}', { age: automationLastRunAge(schedule.lastRunAt, now, locale) });
  const timing = finished
    ? [lastRun, t('No upcoming runs')]
    : schedule.enabled
      ? [
          schedule.nextRunAt === null
            ? t('No upcoming runs')
            : automationNextRun(schedule.nextRunAt, now, t),
          lastRun,
        ]
      : [schedule.pausedReason === null ? t('Paused') : t('Auto-disabled'), lastRun];
  return (
    <section
      className="flex min-w-0 flex-col gap-2.5 not-first:border-t not-first:border-border not-first:pt-3"
      aria-label={automationCadence(schedule, locale, t)}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3
            data-testid="automation-cadence"
            className="m-0 break-words text-ui font-medium text-foreground"
          >
            {automationCadence(schedule, locale, t)}
          </h3>
          <p className="m-0 mt-0.5 text-meta text-content-tertiary">
            {timing.filter((part) => part !== null).join(' · ')}
          </p>
          <p className="m-0 mt-0.5 text-caption text-content-tertiary">{schedule.tz}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('Delete automation')}
          data-testid="automation-delete"
          disabled={busy}
          onClick={() => void change(() => onDelete(schedule.id))}
        >
          <Trash2 />
        </Button>
      </div>
      <p
        data-testid="automation-prompt"
        className="m-0 whitespace-pre-wrap break-words rounded-md bg-secondary px-2.5 py-2 text-meta text-content-secondary"
      >
        {schedule.prompt.trim() === '' ? t('Uses the thread description') : schedule.prompt}
      </p>
      {schedule.pausedReason !== null && (
        <p className="m-0 break-words text-meta text-content-tertiary">{schedule.pausedReason}</p>
      )}
      {!finished && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-meta text-content-secondary">
            {schedule.enabled ? t('Enabled') : t('Paused')}
          </span>
          <ToggleSwitch
            aria-label={t('Enable automation')}
            data-testid="automation-enabled"
            checked={schedule.enabled}
            disabled={busy || (!allowEnable && !schedule.enabled)}
            onCheckedChange={(enabled) => void change(() => onEnabled(schedule.id, enabled))}
          />
        </div>
      )}
      {error !== null && (
        <p role="alert" className="m-0 break-words text-meta text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
