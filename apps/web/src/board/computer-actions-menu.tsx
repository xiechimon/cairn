import {
  COMPUTER_FILE_MISSING,
  type ComputerManageAction,
  type ComputerManageOutcome,
  type ComputerRecord,
} from '@cairn/shared';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export type ComputerActionNote =
  | { kind: 'running'; action: ComputerManageAction }
  | { kind: 'done'; outcome: ComputerManageOutcome }
  | { kind: 'failed'; action: ComputerManageAction; detail: string };

export function computerActionNoteText(note: ComputerActionNote, t: TFunc): string {
  if (note.kind === 'running')
    return {
      stop: t('正在停止虚拟机…'),
      update: t('正在更新虚拟机…'),
      recover: t('正在恢复虚拟机…'),
      reset: t('正在重置虚拟机…'),
      install: t('正在下载 Linux 虚拟机…'),
    }[note.action];
  if (note.kind === 'failed' && note.detail.includes(COMPUTER_FILE_MISSING))
    return t('找不到虚拟机磁盘，请重启 Cairn 再试。');
  if (note.kind === 'failed')
    return {
      stop: t('未能停止虚拟机，请稍后重试。'),
      update: t('未能更新虚拟机，请稍后重试。'),
      recover: t('未能恢复虚拟机，请稍后重试。'),
      reset: t('未能重置虚拟机，请稍后重试。'),
      install: t('未能下载 Linux 虚拟机，请稍后重试。'),
    }[note.action];
  return {
    stopped: t('虚拟机已停止，文件均保留，下次使用时会自动启动。'),
    already_stopped: t('虚拟机本来就是停止的。'),
    updated: t('虚拟机已更新到最新版本，文件均保留。'),
    current: t('虚拟机已经是最新版本。'),
    recovered: t('虚拟机已恢复，文件均保留。'),
    reset: t('虚拟机已重置，现在是一台全新的虚拟机。'),
    installed: t('Linux 虚拟机已下载。'),
  }[note.outcome];
}

export function useComputerActions(teamId: string | undefined, computer: ComputerRecord | null) {
  const { manageComputer } = useApiMutations(teamId);
  const [note, setNote] = useState<ComputerActionNote | null>(null);
  const state = computer?.state;
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state === 'running' && note?.kind === 'failed') setNote(null);
  }
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

export function MachineMenu({
  machineName,
  settingsHref,
  onRename,
  vm,
}: {
  machineName: string;
  settingsHref: string | null;
  onRename: (() => void) | null;
  vm: { disabled: boolean; onAction: (action: ComputerManageAction) => void } | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <>
      <DropdownMenu>
        <IconTooltip
          label={t('{name} 的操作', { name: machineName })}
          trigger={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="machine-menu"
                  className="flex-none pointer-coarse:size-11"
                />
              }
            />
          }
        >
          <Ellipsis aria-hidden strokeWidth={1.75} />
        </IconTooltip>
        <KeyedMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
          {onRename !== null && (
            <KeyedMenuItem shortcut="N" data-testid="machine-rename" onClick={onRename}>
              {t('重命名')}
            </KeyedMenuItem>
          )}
          {settingsHref !== null && (
            <KeyedMenuItem
              shortcut="E"
              data-testid="machine-settings"
              onClick={() => void navigate(settingsHref)}
            >
              {t('执行机设置')}
            </KeyedMenuItem>
          )}
          {vm !== null && (
            <>
              <DropdownMenuSeparator />
              <KeyedMenuItem
                shortcut="S"
                data-testid="computer-action-stop"
                disabled={vm.disabled}
                onClick={() => vm.onAction('stop')}
              >
                {t('停止虚拟机')}
              </KeyedMenuItem>
              <KeyedMenuItem
                shortcut="U"
                data-testid="computer-action-update"
                disabled={vm.disabled}
                onClick={() => vm.onAction('update')}
              >
                {t('更新虚拟机')}
              </KeyedMenuItem>
              <KeyedMenuItem
                shortcut="R"
                data-testid="computer-action-recover"
                disabled={vm.disabled}
                title={t('虚拟机无响应或黑屏时重建它，文件和浏览器登录均保留')}
                onClick={() => vm.onAction('recover')}
              >
                {t('恢复虚拟机')}
              </KeyedMenuItem>
              <KeyedMenuItem
                shortcut="X"
                confirms
                data-testid="computer-action-reset"
                disabled={vm.disabled}
                onClick={() => setConfirmReset(true)}
              >
                {t('重置虚拟机')}
              </KeyedMenuItem>
            </>
          )}
        </KeyedMenuContent>
      </DropdownMenu>
      <AlertDialogShell
        title={t('重置这台虚拟机？')}
        ariaLabel={t('重置虚拟机')}
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('重置')}
            onCancel={() => setConfirmReset(false)}
            onConfirm={() => {
              setConfirmReset(false);
              vm?.onAction('reset');
            }}
          />
        }
      >
        <p className="m-0 text-ui text-foreground" data-testid="computer-reset-loss">
          {t(
            '虚拟机里的文件和浏览器登录都会删除，装过的系统软件要重新批准。之后会启动一台全新的虚拟机。',
          )}
        </p>
      </AlertDialogShell>
    </>
  );
}
