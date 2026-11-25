import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { RenameMachineDialog } from '../board/machines-panel.js';
import { relativeTime } from '../board/rel-time.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { MachineName, machineOsIdentity } from '../components/machine-label.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { useOwnComputerRow } from './own-computer-panel.js';

function machineLoadPercent(
  hardware: NonNullable<MachineRow['capabilities']>['hardware'],
): number | null {
  if (hardware == null) return null;
  const memory =
    hardware.memoryPressure ??
    (hardware.memoryTotalMb > 0 ? 1 - hardware.memoryAvailableMb / hardware.memoryTotalMb : null);
  const cpu = hardware.cpuUtilization ?? null;
  if (memory === null && cpu === null) return null;
  return Math.round(Math.min(1, Math.max(memory ?? 0, cpu ?? 0)) * 100);
}

export function MachineRowView({
  machine,
  machines,
  isDefault,
  highlighted = false,
  now = Date.now(),
}: {
  machine: MachineRow;
  machines: MachineRow[];
  isDefault: boolean;
  highlighted?: boolean;
  now?: number;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const machineId = machine.id ?? '';
  const online = machine.online !== false;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const ownComputer = useOwnComputerRow(machine);

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
  const runningSteps = online ? (machine.runningSteps ?? 0) : 0;
  const loadPct = online ? machineLoadPercent(machine.capabilities?.hardware) : null;
  const lastSeen =
    !online && machine.lastSeenAt != null && machine.lastSeenAt > 0
      ? relativeTime(machine.lastSeenAt, now, t)
      : '';
  return (
    <div
      data-testid="machine-item"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      data-oc-state={ownComputer.state ?? undefined}
      data-highlighted={highlighted ? 'true' : undefined}
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
            {runningSteps > 0 && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid="machine-running"
                  className="whitespace-nowrap tabular-nums text-content-secondary"
                >
                  {t('{n} 个运行中', { n: runningSteps })}
                </span>
              </>
            )}
            {loadPct !== null && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid="machine-load"
                  className="whitespace-nowrap tabular-nums text-content-secondary"
                >
                  {t('负载 {pct}%', { pct: loadPct })}
                </span>
              </>
            )}
            {lastSeen !== '' && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid="machine-last-seen"
                  className="whitespace-nowrap tabular-nums text-content-secondary"
                >
                  {t('上次在线 {ago}', { ago: lastSeen })}
                </span>
              </>
            )}
            {ownComputer.meta}
          </div>
        </div>
        <DropdownMenu>
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
          <KeyedMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
            <KeyedMenuItem
              shortcut="R"
              data-testid="machine-menu-rename"
              disabled={machine.id == null}
              onClick={() => setRenameOpen(true)}
            >
              {t('重命名')}
            </KeyedMenuItem>
            <KeyedMenuItem
              shortcut="F"
              data-testid="machine-menu-default"
              disabled={isDefault || machine.id == null || mutations.patchMachine.isPending}
              onClick={makeDefault}
            >
              {isDefault ? t('已是默认执行机') : t('设为默认执行机')}
            </KeyedMenuItem>
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
        </DropdownMenu>
      </div>
      {ownComputer.drawer}
      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除这台执行机？此操作不可撤销。')}
        summary={<MachineName machine={machine} all={machines} />}
        ariaLabel={t('删除执行机')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={remove}
      />
      {renameOpen && machine.id != null && (
        <RenameMachineDialog
          machineId={machine.id}
          name={machine.name}
          onClose={() => setRenameOpen(false)}
        />
      )}
    </div>
  );
}
