import { Ellipsis, Pause, Pencil, Play, RotateCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { scheduleTitle, scheduleViewState, toWireSchedule } from '../schedules/schedule-model.js';

export function ScheduleRowMenu({
  schedule,
  now,
  onEdit,
}: {
  schedule: ScheduleRecord;
  now: number;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const title = scheduleTitle(schedule);
  const state = scheduleViewState(toWireSchedule(schedule));
  const enabled = schedule.enabled ?? true;
  const running =
    schedule.todo !== null && ['queued', 'planning', 'building'].includes(schedule.todo.phase);
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
        onError: (error) => toastError(t('定时未能更新，请重试。'), error),
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
                    aria-label={t('{title} 的定时菜单', { title })}
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
            disabled={state === 'finished' || !enabled || running || queued}
            onClick={runNow}
          >
            <Play />
            {t('立即运行')}
          </KeyedMenuItem>
          {state !== 'finished' && (
            <KeyedMenuItem
              shortcut="P"
              data-action="toggle"
              disabled={!enabled && schedule.todo?.phase === 'closed'}
              onClick={setEnabled}
            >
              {enabled ? <Pause /> : <RotateCw />}
              {enabled ? t('暂停定时') : t('恢复定时')}
            </KeyedMenuItem>
          )}
          <KeyedMenuItem shortcut="E" data-action="edit" onClick={onEdit}>
            <Pencil />
            {t('编辑')}
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
        summary={title}
        ariaLabel={t('删除定时')}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={remove}
      />
    </>
  );
}
