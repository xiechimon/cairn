import { MACHINE_RUNTIMES, type MachineOsPlatform, type MachineRuntime } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { ChevronRight, Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { MachineName, machineLabel } from '../components/machine-label.js';
import { SETTINGS_SELECT_TRIGGER_CLS, SettingsSelectTrigger } from '../components/settings-list.js';
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
import { AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { Select, SelectContent, SelectItem, SelectValue } from '../components/ui/select.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { type ChiefState, MachineDetailPane } from './machine-detail-pane.js';

export type RowSection = 'runtime' | 'capabilities';

type ItemStatus = { label: string; dot: string };

const OS_NAMES: Record<MachineOsPlatform, string | undefined> = {
  linux: 'Linux',
  darwin: 'macOS',
  windows: 'Windows',
  other: undefined,
};

export function rowStatus(machine: MachineRow, notice: 'expired' | 'expiring' | null): ItemStatus {
  if (machine.online === false) return { label: '离线', dot: 'bg-content-dim' };
  if (notice === 'expired') return { label: '登录已过期', dot: 'bg-(--card-button)' };
  if (notice === 'expiring') return { label: '登录将过期', dot: 'bg-(--card-button)' };
  return { label: '在线', dot: 'bg-running' };
}

const isMachineRuntime = (value: string): value is MachineRuntime =>
  (MACHINE_RUNTIMES as readonly string[]).includes(value);

export function MachineRowView({
  machine,
  machines,
  isDefault,
  chief,
  status,
  expanded,
  section,
  onToggle,
  onOpenSection,
  onClosed,
}: {
  machine: MachineRow;
  machines: MachineRow[];
  isDefault: boolean;
  chief: ChiefState;
  status: ItemStatus;
  expanded: boolean;
  section: RowSection | null;
  onToggle: () => void;
  onOpenSection: (section: RowSection) => void;
  onClosed: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const queryClient = useQueryClient();
  const machineId = machine.id ?? '';
  const online = machine.online !== false;
  const others = machines.filter((m) => m.id !== machine.id);
  const [now] = useState(() => Date.now());

  const [evacuateOpen, setEvacuateOpen] = useState(false);
  const [evacuateTarget, setEvacuateTarget] = useState<string | null>(null);
  const [evacuating, setEvacuating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded || section === null) return;
    const target = bodyRef.current?.querySelector(
      `[data-testid="machine-${section === 'runtime' ? 'runtimes' : 'capabilities'}"]`,
    );
    target?.scrollIntoView({ block: 'nearest' });
    if (section === 'runtime') {
      target
        ?.querySelector<HTMLElement>('[data-testid="provider-toggle"]:not([disabled])')
        ?.focus();
    }
  }, [expanded, section]);

  const pickedTarget = others.find((m) => m.id === evacuateTarget);
  const [draft, setDraft] = useState<string[] | null>(null);
  const shown = draft === null ? machine : { ...machine, enabledRuntimes: draft };
  const enabled = (shown.enabledRuntimes ?? []).some(isMachineRuntime);
  const writeRuntimes = (enabledRuntimes: MachineRuntime[]) => {
    if (!live) {
      if (blockDemoWrite()) return;
      setDraft(enabledRuntimes);
      return;
    }
    mutations.patchMachine.mutate(
      { id: machineId, body: { enabledRuntimes } },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };
  const setAccepting = (next: boolean) => {
    if (next) {
      onOpenSection('runtime');
      toast(t('选择这台 Runner 接哪些运行时'));
      return;
    }
    writeRuntimes([]);
  };
  const toggleRuntime = (runtime: MachineRuntime, next: boolean) => {
    const current = (shown.enabledRuntimes ?? []).filter(isMachineRuntime);
    writeRuntimes(
      next ? [...new Set([...current, runtime])] : current.filter((r) => r !== runtime),
    );
  };

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
      { onError: (error) => toastError(t('设为默认 Runner 失败，请重试。'), error) },
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
      onClosed();
    } catch (error) {
      toastError(t('删除 Runner 失败，请重试。'), error);
    } finally {
      setDeleting(false);
    }
  };

  const lastSeen =
    machine.online === false && machine.lastSeenAt != null
      ? t('最后在线 {time}', { time: relativeTime(machine.lastSeenAt, now, t) })
      : null;
  const osPlatform = machine.capabilities?.osPlatform;
  const osName = osPlatform === undefined ? undefined : OS_NAMES[osPlatform];
  const canMutate = machine.id != null && online;
  const acceptFrozen = !canMutate || mutations.patchMachine.isPending;
  const acceptBlockedReason = online
    ? undefined
    : t('重新连接 {name} 后才能修改它的设置。', { name: machine.name });
  const bodyId = `machine-body-${machineId}`;
  return (
    <div
      data-testid="machine-item"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      data-expanded={expanded}
      className="flex min-w-0 flex-col border-b border-border last:border-b-0"
    >
      <div
        className={cn(
          'relative flex min-w-0 items-center gap-3 px-4 py-2',
          'has-[[data-testid=machine-toggle]:focus-visible]:outline-2 has-[[data-testid=machine-toggle]:focus-visible]:-outline-offset-2 has-[[data-testid=machine-toggle]:focus-visible]:outline-(--focus-ring)',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Button
            variant="link"
            data-testid="machine-toggle"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
            className="h-auto min-w-0 cursor-pointer justify-start gap-1.5 rounded-sm p-0 text-left text-ui font-medium text-foreground no-underline outline-hidden after:absolute after:inset-0 focus-visible:ring-0"
          >
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                'size-4 flex-none text-content-tertiary transition-transform duration-(--dur-fast)',
                expanded && 'rotate-90',
              )}
            />
            <span data-testid="machine-item-name" className="truncate">
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
            {chief.host && (
              <span
                data-orchestration="host"
                className="flex-none text-meta font-normal text-content-tertiary"
              >
                {t('Coordinator 主机')}
              </span>
            )}
          </Button>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 pl-5 text-meta">
            {osName !== undefined && (
              <>
                <span data-testid="machine-os" className="whitespace-nowrap text-content-secondary">
                  {osName}
                </span>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
              </>
            )}
            <span aria-hidden className={cn('size-1.5 flex-none rounded-full', status.dot)} />
            <span
              data-testid="machine-item-status"
              className="whitespace-nowrap text-content-secondary"
            >
              {t(status.label)}
            </span>
            {lastSeen !== null && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <span
                  data-testid="machine-last-seen"
                  className="whitespace-nowrap text-content-tertiary"
                >
                  {lastSeen}
                </span>
              </>
            )}
            <span aria-hidden className="text-content-dim">
              ·
            </span>
            <Button
              variant="link"
              data-testid="machine-open-runtime"
              onClick={() => onOpenSection('runtime')}
              className="relative z-10 h-auto rounded-sm p-0 text-meta font-normal text-content-tertiary no-underline after:absolute after:-inset-y-1 after:inset-x-0 hover:text-foreground"
            >
              {t('运行时')} ›
            </Button>
            {machine.capabilities !== undefined && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <Button
                  variant="link"
                  data-testid="machine-open-capabilities"
                  onClick={() => onOpenSection('capabilities')}
                  className="relative z-10 h-auto rounded-sm p-0 text-meta font-normal text-content-tertiary no-underline after:absolute after:-inset-y-1 after:inset-x-0 hover:text-foreground"
                >
                  {t('能力')} ›
                </Button>
              </>
            )}
          </div>
        </div>
        <ExplainDisabledToggle
          className="relative z-10"
          disabled={acceptFrozen}
          reason={acceptBlockedReason}
        >
          <ToggleSwitch
            data-testid="machine-accept-toggle"
            aria-label={t('{name} 接任务', { name: machine.name })}
            checked={enabled}
            disabled={acceptFrozen}
            title={
              online
                ? enabled
                  ? undefined
                  : t('选择这台 Runner 接哪些运行时')
                : acceptBlockedReason
            }
            onCheckedChange={setAccepting}
          />
        </ExplainDisabledToggle>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="machine-menu"
                className="relative z-10 hover:bg-transparent dark:hover:bg-transparent"
                aria-label={t('{name} 的菜单', { name: machine.name })}
              />
            }
          >
            <Ellipsis aria-hidden strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
            <DropdownMenuItem
              data-testid="machine-menu-default"
              disabled={isDefault || machine.id == null || mutations.patchMachine.isPending}
              onClick={makeDefault}
            >
              {isDefault ? t('已是默认 Runner') : t('设为默认 Runner')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="machine-menu-evacuate"
              disabled={others.length === 0}
              onClick={() => setEvacuateOpen(true)}
            >
              {t('整机迁移')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="machine-menu-delete"
              disabled={deleting}
              title={t('删除后，这台 Runner 要重新注册才能再接任务')}
              onClick={() => setConfirmOpen(true)}
            >
              {t('删除 Runner')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded && (
        <div id={bodyId} ref={bodyRef}>
          <MachineDetailPane
            machine={shown}
            chief={chief}
            pending={mutations.patchMachine.isPending}
            onToggleRuntime={toggleRuntime}
          />
        </div>
      )}
      <AlertDialogShell
        title={t('整机迁移')}
        subtitle={t('把固定在这台 Runner 上的路由规则一起迁到另一台 Runner。')}
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
              {pickedTarget === undefined ? t('迁移到…') : machineLabel(pickedTarget, machines)}
            </SelectValue>
          </SettingsSelectTrigger>
          <SelectContent aria-label={t('迁移到')}>
            {others.map((m) => (
              <SelectItem key={m.id} className="machine-evacuate-row" value={m.id ?? ''}>
                <MachineName machine={m} all={machines} />
                {m.online === false ? `（${t('离线')}）` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </AlertDialogShell>
      <DeleteConfirm
        open={confirmOpen}
        title={t('确定删除这台 Runner？此操作不可撤销。')}
        summary={machine.name}
        ariaLabel={t('删除 Runner')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
