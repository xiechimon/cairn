import type { ComputerManageAction, ComputerManageOutcome, ComputerRecord } from '@cairn/shared';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export type ComputerActionNote =
  | { kind: 'running'; action: ComputerManageAction }
  | { kind: 'done'; outcome: ComputerManageOutcome }
  | { kind: 'failed'; action: ComputerManageAction; detail: string };

export function computerActionNoteText(note: ComputerActionNote, t: TFunc): string {
  if (note.kind === 'running')
    return {
      stop: t('正在停止电脑…'),
      update: t('正在更新电脑…'),
      recover: t('正在恢复电脑…'),
      reset: t('正在重置电脑…'),
      install: t('正在下载 Linux 虚拟机…'),
    }[note.action];
  if (note.kind === 'failed')
    return {
      stop: t('没能停止电脑，请稍后重试。'),
      update: t('没能更新电脑，请稍后重试。'),
      recover: t('没能恢复电脑，请稍后重试。'),
      reset: t('没能重置电脑，请稍后重试。'),
      install: t('没能下载 Linux 虚拟机，请稍后重试。'),
    }[note.action];
  return {
    stopped: t('电脑已停止，文件都还在，下次使用时会自动启动。'),
    already_stopped: t('电脑本来就是停止的。'),
    updated: t('电脑已更新到最新版本，文件都还在。'),
    current: t('电脑已经是最新版本。'),
    recovered: t('电脑已恢复，文件都还在。'),
    reset: t('电脑已重置，现在是一台全新的电脑。'),
    installed: t('Linux 虚拟机已下载。'),
  }[note.outcome];
}

export function useComputerActions(teamId: string | undefined, computer: ComputerRecord | null) {
  const { manageComputer } = useApiMutations(teamId);
  const [note, setNote] = useState<ComputerActionNote | null>(null);
  const run = (action: ComputerManageAction) => {
    if (computer === null) return;
    setNote({ kind: 'running', action });
    manageComputer.mutate(
      { computerId: computer.id, action },
      {
        onSuccess: (result) => setNote({ kind: 'done', outcome: result.outcome }),
        onError: (error) =>
          setNote({
            kind: 'failed',
            action,
            detail: error instanceof Error ? error.message : String(error),
          }),
      },
    );
  };
  return { note, run, pending: manageComputer.isPending };
}

export function ComputerActionsMenu({
  machineName,
  disabled,
  onAction,
}: {
  machineName: string;
  disabled: boolean;
  onAction: (action: ComputerManageAction) => void;
}) {
  const { t } = useI18n();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <>
      <DropdownMenu>
        <IconTooltip
          label={t('{name} 的电脑操作', { name: machineName })}
          trigger={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="computer-actions"
                  className="flex-none pointer-coarse:size-11"
                />
              }
            />
          }
        >
          <Ellipsis aria-hidden strokeWidth={1.75} />
        </IconTooltip>
        <KeyedMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
          <KeyedMenuItem
            shortcut="S"
            data-testid="computer-action-stop"
            disabled={disabled}
            onClick={() => onAction('stop')}
          >
            {t('停止电脑')}
          </KeyedMenuItem>
          <KeyedMenuItem
            shortcut="U"
            data-testid="computer-action-update"
            disabled={disabled}
            onClick={() => onAction('update')}
          >
            {t('更新电脑')}
          </KeyedMenuItem>
          <KeyedMenuItem
            shortcut="R"
            data-testid="computer-action-recover"
            disabled={disabled}
            title={t('电脑卡住或黑屏时重建它，文件和浏览器登录都保留')}
            onClick={() => onAction('recover')}
          >
            {t('恢复电脑')}
          </KeyedMenuItem>
          <KeyedMenuItem
            shortcut="X"
            confirms
            data-testid="computer-action-reset"
            disabled={disabled}
            onClick={() => setConfirmReset(true)}
          >
            {t('重置电脑')}
          </KeyedMenuItem>
        </KeyedMenuContent>
      </DropdownMenu>
      <AlertDialogShell
        title={t('重置这台电脑？')}
        ariaLabel={t('重置电脑')}
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('重置')}
            onCancel={() => setConfirmReset(false)}
            onConfirm={() => {
              setConfirmReset(false);
              onAction('reset');
            }}
          />
        }
      >
        <p className="m-0 text-ui text-foreground" data-testid="computer-reset-loss">
          {t(
            '电脑里的文件和浏览器登录都会删除，装过的系统软件要重新批准。之后会启动一台全新的电脑。',
          )}
        </p>
      </AlertDialogShell>
    </>
  );
}
