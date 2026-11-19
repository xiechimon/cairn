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
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { useComputerGrantsRow } from './computer-grants-panel.js';
import { useFolderGrantsRow } from './folder-grants-panel.js';
import { useOwnComputerRow } from './own-computer-panel.js';

export function MachineRowView({
  machine,
  machines,
  isDefault,
}: {
  machine: MachineRow;
  machines: MachineRow[];
  isDefault: boolean;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const machineId = machine.id ?? '';
  const online = machine.online !== false;

  const [confirmOpen, setConfirmOpen] = useState(false);

  const ownComputer = useOwnComputerRow(machine);
  const computerGrants = useComputerGrantsRow(machine);
  const folders = useFolderGrantsRow(machine);

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
      className="flex min-w-0 flex-col border-b border-border last:border-b-0"
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
            {ownComputer.meta}
            {computerGrants.meta}
            {folders.meta}
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
              disabled={mutations.deleteMachine.isPending}
              title={t('删除后，这台执行机要重新注册才能再接任务')}
              onClick={() => setConfirmOpen(true)}
            >
              {t('删除执行机')}
            </KeyedMenuItem>
          </KeyedMenuContent>
        </DropdownMenu>
      </div>
      {ownComputer.drawer}
      {computerGrants.drawer}
      {folders.drawer}
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
