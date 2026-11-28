import {
  type MachineCapabilities,
  MIN_SUPPORTED_RUNNER_PROTOCOL,
  PUBLISHED_PACKAGES,
  runnerNeedsUpdate,
  runnerOutOfWindow,
} from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { MachineName, machineOsIdentity } from '../components/machine-label.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { toast, toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { CopyCommand, startCommand, useRunnerServerAccess } from './create-machine-dialog.js';
import { useOwnComputerRow } from './own-computer-panel.js';

export interface RunnerUpdateSummary {
  text: string;
  tone: 'quiet' | 'error';
  testId: string;
  outOfWindow?: boolean;
}

export function runnerUpdateSummary(
  capabilities: MachineCapabilities | null | undefined,
  online: boolean,
  t: TFunc,
): RunnerUpdateSummary | null {
  if (!online) return null;
  const auto = capabilities?.runnerAutoUpdate;
  if (auto?.state === 'downloading') {
    return {
      text: auto.targetVersion
        ? t('正在自动更新到 {version}…', { version: auto.targetVersion })
        : t('正在自动更新…'),
      tone: 'quiet',
      testId: 'machine-auto-update',
    };
  }
  if (auto?.state === 'waiting-idle') {
    return {
      text: auto.targetVersion
        ? t('空闲后将自动更新到 {version}', { version: auto.targetVersion })
        : t('空闲后将自动更新'),
      tone: 'quiet',
      testId: 'machine-auto-update',
    };
  }
  if (auto?.state === 'swapping') {
    return {
      text: auto.targetVersion
        ? t('正在重启到 {version}…', { version: auto.targetVersion })
        : t('正在重启…'),
      tone: 'quiet',
      testId: 'machine-auto-update',
    };
  }
  if (auto?.state === 'rolled-back') {
    return {
      text:
        auto.failedVersion && auto.restoredVersion
          ? t('{failed} 未能启动，已恢复到 {restored}', {
              failed: auto.failedVersion,
              restored: auto.restoredVersion,
            })
          : t('自动更新失败，已恢复旧版本'),
      tone: 'error',
      testId: 'machine-auto-update',
    };
  }
  if (!runnerNeedsUpdate(capabilities)) return null;
  const outOfWindow = runnerOutOfWindow(capabilities, MIN_SUPPORTED_RUNNER_PROTOCOL);
  return {
    text: outOfWindow ? t('更新 Cairn 后才能接新任务') : t('需要更新 Cairn'),
    tone: 'quiet',
    testId: 'machine-needs-update',
    ...(outOfWindow ? { outOfWindow: true } : {}),
  };
}

export function MachineRowView({
  machine,
  machines,
  isDefault,
  highlighted = false,
  onPairPhone,
}: {
  machine: MachineRow;
  machines: MachineRow[];
  isDefault: boolean;
  highlighted?: boolean;
  onPairPhone?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const machineId = machine.id ?? '';
  const online = machine.online !== false;
  const isLocal = machine.kind === 'local';
  const reauthRequired = machine.tokenReauthRequired === true;
  const updateSummary = runnerUpdateSummary(machine.capabilities, online, t);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const ownComputer = useOwnComputerRow(machine);
  const { access } = useRunnerServerAccess(reauthRequired && !isLocal);
  const serverOrigin = access?.state === 'ready' && access.url !== null ? access.url : null;
  const reconnectCmd =
    serverOrigin === null
      ? null
      : `${PUBLISHED_PACKAGES.cli.command} logout && ${startCommand(serverOrigin)}`;

  const handleMenuOpenChange = (nextOpen: boolean) => {
    setMenuOpen(nextOpen);
    if (!nextOpen) setConfirmRotate(false);
  };

  const rotateToken = () => {
    if (!confirmRotate) {
      setConfirmRotate(true);
      return;
    }
    setConfirmRotate(false);
    setMenuOpen(false);
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.rotateMachineToken.mutate(machineId, {
      onSuccess: (result) => {
        if (result.delivery === 'pushed') {
          toastSuccess(t('已更换令牌，执行机保持在线'));
        } else {
          toast.info(t('旧令牌已失效，请在该电脑上重新连接'));
        }
      },
      onError: (error) => toastError(t('更换令牌失败，请重试。'), error),
    });
  };

  const makeDefault = () => {
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.patchMachine.mutate(
      { id: machineId, body: { isDefault: true } },
      { onError: (error) => toastError(t('设为默认执行机失败，请重试。'), error) },
    );
  };

  const remove = () => {
    setConfirmOpen(false);
    if (!live) {
      blockDemoWrite();
      return;
    }
    mutations.deleteMachine.mutate(machineId, {
      onError: (error) => toastError(t('删除执行机失败，请重试。'), error),
    });
  };

  const osName = machineOsIdentity(machine)?.label;
  return (
    <div
      data-testid="machine-item"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      data-oc-state={ownComputer.state ?? undefined}
      className={cn(
        'flex min-w-0 flex-col border-b border-border last:border-b-0',
        highlighted && 'bg-(--menu-hover)/60 ring-2 ring-inset ring-(--focus-ring)',
      )}
    >
      <div className="flex min-w-0 items-center gap-3 px-4 py-2 pointer-coarse:pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5 text-ui font-medium text-foreground">
            <span data-testid="machine-item-name" className="min-w-0 wrap-anywhere">
              <MachineName machine={machine} all={machines} />
            </span>
            {isDefault && (
              <Badge
                variant="outline"
                data-testid="machine-default"
                className="flex-none font-normal"
              >
                {t('默认')}
              </Badge>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta">
            <span data-testid="machine-os" className="whitespace-nowrap text-content-secondary">
              {osName ?? t('系统未知')}
            </span>
            {machine.hostname !== undefined && machine.hostname !== machine.name && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid="machine-hostname"
                  className="min-w-0 truncate text-content-secondary"
                >
                  {machine.hostname}
                </span>
              </>
            )}
            <span aria-hidden className="text-content-dim">
              ·
            </span>
            <span
              aria-hidden
              className={cn(
                'grow-light size-1.5 flex-none rounded-full',
                online ? 'bg-running' : 'bg-content-dim',
              )}
            />
            <span
              data-testid="machine-item-status"
              className="whitespace-nowrap text-content-secondary"
            >
              {online ? t('在线') : t('离线')}
            </span>
            {reauthRequired && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid="machine-token-reauth-status"
                  className="whitespace-nowrap text-(--waiting-ink)"
                >
                  {t('需要重新连接')}
                </span>
              </>
            )}
            {updateSummary !== null && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid={updateSummary.testId}
                  data-out-of-window={updateSummary.outOfWindow || undefined}
                  className={cn(
                    'whitespace-nowrap',
                    updateSummary.tone === 'error'
                      ? 'text-tint-fail-ink'
                      : 'text-content-secondary',
                  )}
                >
                  {updateSummary.text}
                </span>
              </>
            )}
            {ownComputer.meta}
          </div>
        </div>
        <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
          <IconTooltip
            label={t('{name} 的菜单', { name: machine.name })}
            trigger={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-testid="machine-menu"
                    className="hover:bg-transparent pointer-coarse:-mr-2 pointer-coarse:size-11 dark:hover:bg-transparent"
                  />
                }
              />
            }
          >
            <Ellipsis aria-hidden strokeWidth={1.75} />
          </IconTooltip>
          <div
            className="contents"
            onKeyDownCapture={(event) => {
              if (event.repeat) event.stopPropagation();
            }}
          >
            <KeyedMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
              <KeyedMenuItem
                shortcut="F"
                data-testid="machine-menu-default"
                disabled={isDefault || machine.id == null || mutations.patchMachine.isPending}
                onClick={makeDefault}
              >
                {isDefault ? t('已是默认执行机') : t('设为默认执行机')}
              </KeyedMenuItem>
              <KeyedMenuItem
                shortcut="R"
                data-testid="machine-menu-rotate-token"
                data-confirming={confirmRotate ? 'true' : undefined}
                closeOnClick={confirmRotate}
                variant={confirmRotate ? 'destructive' : 'default'}
                disabled={machine.id == null || mutations.rotateMachineToken.isPending}
                title={t('如果执行机在线，会自动切换到新令牌；离线或已丢失请用「删除执行机」')}
                onClick={rotateToken}
              >
                {confirmRotate ? t('确认更换令牌') : t('更换令牌')}
              </KeyedMenuItem>
              {onPairPhone !== undefined && (
                <KeyedMenuItem
                  shortcut="P"
                  data-testid="machine-menu-pair-phone"
                  onClick={() => {
                    setMenuOpen(false);
                    onPairPhone();
                  }}
                >
                  {t('配对安卓手机…')}
                </KeyedMenuItem>
              )}
              <KeyedMenuItem
                shortcut="D"
                confirms
                data-testid="machine-menu-delete"
                disabled={machine.id == null || mutations.deleteMachine.isPending}
                title={t('删除后，这台执行机要重新注册才能再接任务')}
                onClick={() => setConfirmOpen(true)}
              >
                {t('删除执行机')}
              </KeyedMenuItem>
            </KeyedMenuContent>
          </div>
        </DropdownMenu>
      </div>
      {reauthRequired && (
        <div
          data-testid="machine-token-reauth-drawer"
          className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-2"
        >
          {isLocal ? (
            <p className="m-0 text-meta text-content-secondary">
              {t('旧令牌已失效。重启桌面端或在主机终端重启 Cairn 后，这台执行机即可重新连接。')}
            </p>
          ) : reconnectCmd !== null ? (
            <>
              <p className="m-0 text-meta text-content-secondary">
                {t('旧令牌已失效。在这台电脑运行以下命令重新连接：')}
              </p>
              <CopyCommand command={reconnectCmd} />
            </>
          ) : (
            <p className="m-0 text-meta text-content-secondary">
              {t('旧令牌已失效。开启远程访问后，在那台电脑登出并重新连接这台主机。')}
            </p>
          )}
        </div>
      )}
      {ownComputer.drawer}
      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除这台执行机？此操作不可撤销。')}
        summary={<MachineName machine={machine} all={machines} />}
        ariaLabel={t('删除执行机')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
    </div>
  );
}
