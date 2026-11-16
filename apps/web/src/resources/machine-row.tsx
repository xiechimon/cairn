import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { MachineName, machineOsIdentity } from '../components/machine-label.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { SETTINGS_SELECT_TRIGGER_CLS, SettingsSelectTrigger } from '../components/settings-list.js';
import { AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';

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
  const queryClient = useQueryClient();
  const machineId = machine.id ?? '';
  const online = machine.online !== false;
  const others = machines.filter((m) => m.id !== machine.id);

  const [evacuateOpen, setEvacuateOpen] = useState(false);
  const [evacuateTarget, setEvacuateTarget] = useState<string | null>(null);
  const [evacuating, setEvacuating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const pickedTarget = others.find((m) => m.id === evacuateTarget);
  const evacuate = async () => {
    if (evacuateTarget === null) return;
    setEvacuating(true);
    try {
      const res = await fetch(`/api/machines/${machineId}/evacuate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetMachineId: evacuateTarget }),
      });
      const body = (await res.json()) as {
        moved?: string[];
        rejected?: { agentId: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if ((body.rejected?.length ?? 0) > 0) {
        toastError(
          t('{n} 条路由规则未过校验留在原机', { n: body.rejected?.length ?? 0 }),
          new Error(body.rejected?.map((r) => r.reason).join('；')),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['machines', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['members', teamId] });
      setEvacuateOpen(false);
      setEvacuateTarget(null);
    } catch (error) {
      toastError(t('整机迁移失败，请重试。'), error);
    } finally {
      setEvacuating(false);
    }
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

  const remove = async () => {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/machines/${machineId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      void queryClient.invalidateQueries({ queryKey: ['machines', teamId] });
      void queryClient.invalidateQueries({ queryKey: ['members', teamId] });
    } catch (error) {
      toastError(t('删除执行机失败，请重试。'), error);
    } finally {
      setDeleting(false);
    }
  };

  const osName = machineOsIdentity(machine)?.label;
  return (
    <div
      data-testid="machine-item"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
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
            <span aria-hidden className="text-content-dim">
              ·
            </span>
            <span
              aria-hidden
              className={cn(
                'size-1.5 flex-none rounded-full',
                online ? 'bg-running' : 'bg-content-dim',
              )}
            />
            <span
              data-testid="machine-item-status"
              className="whitespace-nowrap text-content-secondary"
            >
              {online ? t('在线') : t('离线')}
            </span>
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
              shortcut="M"
              data-testid="machine-menu-evacuate"
              disabled={others.length === 0}
              onClick={() => setEvacuateOpen(true)}
            >
              {t('整机迁移')}
            </KeyedMenuItem>
            <KeyedMenuItem
              shortcut="D"
              confirms
              data-testid="machine-menu-delete"
              disabled={deleting}
              title={t('删除后，这台执行机要重新注册才能再接任务')}
              onClick={() => setConfirmOpen(true)}
            >
              {t('删除执行机')}
            </KeyedMenuItem>
          </KeyedMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialogShell
        title={t('整机迁移')}
        subtitle={t('把固定在这台执行机上的路由规则一起迁到另一台执行机。')}
        ariaLabel={t('整机迁移')}
        open={evacuateOpen}
        onClose={() => setEvacuateOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setEvacuateOpen(false)}
            >
              {t('取消')}
            </Button>
            <Button
              variant="outline"
              className={DIALOG_PRIMARY_BUTTON}
              disabled={evacuateTarget === null || evacuating}
              onClick={() => void evacuate()}
              data-testid="machine-evacuate-btn"
            >
              {t('整机迁移')}
            </Button>
          </>
        }
      >
        <Select value={evacuateTarget} onValueChange={(v) => setEvacuateTarget(v as string)}>
          <SettingsSelectTrigger
            aria-label={t('迁移到')}
            className={`machine-evacuate-select ${SETTINGS_SELECT_TRIGGER_CLS}`}
          >
            <SelectValue>
              {pickedTarget === undefined ? (
                t('迁移到…')
              ) : (
                <MachineName machine={pickedTarget} all={machines} compact />
              )}
            </SelectValue>
          </SettingsSelectTrigger>
          <SelectContent
            aria-label={t('迁移到')}
            className="w-max min-w-0 max-w-(--available-width)"
          >
            {others.map((m) => (
              <SelectItem
                key={m.id}
                className="machine-evacuate-row h-auto! min-h-8 py-1! [&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:whitespace-normal [&>:first-child]:[overflow-wrap:anywhere]"
                value={m.id ?? ''}
              >
                <MachineName machine={m} all={machines} />
                {m.online === false ? `（${t('离线')}）` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AlertDialogShell>
      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除这台执行机？此操作不可撤销。')}
        summary={<MachineName machine={machine} all={machines} />}
        ariaLabel={t('删除执行机')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
