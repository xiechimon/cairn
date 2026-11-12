import type { ScheduleRecord as WireSchedule } from '@cairn/shared';
import { CalendarClock, Ellipsis, History, Pause, Play, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Trash2 } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { scheduleViewState } from '../schedules/schedule-model.js';

function viewState(schedule: ScheduleRecord) {
  const record: WireSchedule = {
    ...schedule,
    cron: schedule.cron ?? null,
    prompt: schedule.prompt ?? '',
    enabled: schedule.enabled ?? true,
    pausedReason: schedule.pausedReason ?? null,
    lastRunAt: schedule.lastRunAt ?? null,
    lastRunStatus: schedule.lastRunStatus ?? null,
  };
  return scheduleViewState(record);
}

export function ScheduleRowMenu({
  schedule,
  now,
  onOpenDetail,
}: {
  schedule: ScheduleRecord;
  now: number;
  onOpenDetail: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const state = viewState(schedule);
  const enabled = schedule.enabled ?? true;
  const running = ['queued', 'planning', 'building'].includes(schedule.todo.phase);
  const queued = enabled && schedule.nextRunAt != null && schedule.nextRunAt <= now;
  const guarded = (action: () => void) => () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    action();
  };
  const setEnabled = guarded(() =>
    mutations.patchSchedule.mutate(
      { id: schedule.id, body: { enabled: !enabled } },
      {
        onSuccess: () => toastSuccess(enabled ? t('定时已暂停。') : t('定时已恢复。')),
        onError: (error) => toastError(t('定时没能更新，请重试。'), error),
      },
    ),
  );
  const runNow = guarded(() =>
    mutations.runSchedule.mutate(schedule.id, {
      onSuccess: () => toastSuccess(t('已排上立即运行。')),
      onError: (error) => toastError(t('运行请求未送出，请重试。'), error),
    }),
  );
  const remove = () => {
    setConfirmingDelete(false);
    guarded(() =>
      mutations.deleteSchedule.mutate(schedule.id, {
        onError: (error) => toastError(t('删除定时失败，请重试。'), error),
      }),
    )();
  };
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-testid="schedule-row-menu-button"
                    className="size-6 text-content-tertiary pointer-coarse:size-11"
                    aria-label={t('{title} 的定时菜单', { title: schedule.todo.title })}
                  />
                }
              />
            }
          >
            <Ellipsis />
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            {t('更多')}
          </TooltipContent>
        </Tooltip>
        <KeyedMenuContent
          align="end"
          sideOffset={4}
          aria-label={t('更多')}
          className="w-auto min-w-40"
        >
          <KeyedMenuItem
            shortcut="N"
            data-action="run"
            disabled={!enabled || running || queued}
            onClick={runNow}
          >
            <Play />
            {t('立即运行')}
          </KeyedMenuItem>
          {state !== 'finished' && (
            <KeyedMenuItem shortcut="P" data-action="toggle" onClick={setEnabled}>
              {enabled ? <Pause /> : <RotateCw />}
              {enabled ? t('暂停定时') : t('恢复定时')}
            </KeyedMenuItem>
          )}
          <KeyedMenuItem shortcut="H" data-action="detail" onClick={onOpenDetail}>
            <History />
            {t('查看详情')}
          </KeyedMenuItem>
          <KeyedMenuItem
            shortcut="M"
            data-action="manage"
            onClick={() => navigate('/app/schedules')}
          >
            <CalendarClock />
            {t('管理定时')}
          </KeyedMenuItem>
          <DropdownMenuSeparator />
          <KeyedMenuItem
            shortcut="D"
            confirms
            variant="destructive"
            data-action="delete"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 />
            {t('删除')}
          </KeyedMenuItem>
        </KeyedMenuContent>
      </DropdownMenu>
      <DeleteConfirm
        open={confirmingDelete}
        title={t('确定删除该定时？此操作不可撤销。')}
        summary={schedule.todo.title}
        ariaLabel={t('删除定时')}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={remove}
      />
    </>
  );
}
