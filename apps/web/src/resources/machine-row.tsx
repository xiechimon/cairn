import { MACHINE_RUNTIMES, type MachineRuntime } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { ChevronRight, Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { MachineName, machineLabel } from '../components/machine-label.js';
import { SETTINGS_SELECT_TRIGGER_CLS, SettingsSelectTrigger } from '../components/settings-list.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
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
import type { FixtureSet, MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { type ChiefState, MachineDetailPane, useHomeAgents } from './machine-detail-pane.js';

export type RowSection = 'runtime' | 'capabilities';

type ItemStatus = { label: string; dot: string };

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
  chief,
  fixture,
  search,
  status,
  expanded,
  section,
  onToggle,
  onOpenSection,
  onClosed,
}: {
  machine: MachineRow;
  machines: MachineRow[];
  chief: ChiefState;
  fixture: FixtureSet;
  search: string;
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
  const { membersQ, homeAgents } = useHomeAgents(machine, fixture);
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
    bodyRef.current
      ?.querySelector(
        `[data-testid="machine-${section === 'runtime' ? 'runtimes' : 'capabilities'}"]`,
      )
      ?.scrollIntoView({ block: 'nearest' });
  }, [expanded, section]);

  const pickedTarget = others.find((m) => m.id === evacuateTarget);
  const enabled = (machine.enabledRuntimes ?? []).some(isMachineRuntime);
  const setAccepting = (next: boolean) => {
    const ready = MACHINE_RUNTIMES.filter(
      (runtime) =>
        !(machine.providers ?? []).some((p) => p.runtime === runtime && p.login === 'logged-out'),
    );
    const enabledRuntimes = next ? (ready.length > 0 ? ready : [...MACHINE_RUNTIMES]) : [];
    mutations.patchMachine.mutate(
      { id: machineId, body: { enabledRuntimes } },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
    );
  };
  const toggleRuntime = (runtime: MachineRuntime, next: boolean) => {
    const current = (machine.enabledRuntimes ?? []).filter(isMachineRuntime);
    const enabledRuntimes = next
      ? [...new Set([...current, runtime])]
      : current.filter((r) => r !== runtime);
    mutations.patchMachine.mutate(
      { id: machineId, body: { enabledRuntimes } },
      { onError: (error) => toastError(t('保存失败，请重试。'), error) },
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
          t('{n} 个 agent 未过校验留在原机', { n: body.rejected?.length ?? 0 }),
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
      toastError(t('删除机器失败，请重试。'), error);
    } finally {
      setDeleting(false);
    }
  };

  const lastSeen =
    machine.online === false && machine.lastSeenAt != null
      ? t('最后在线 {time}', { time: relativeTime(machine.lastSeenAt, now, t) })
      : null;
  const canMutate = live && machine.id != null && online;
  const bodyId = `machine-body-${machineId}`;
  return (
    <div
      data-testid="machine-item"
      data-machine-id={machine.id}
      data-kind={machine.kind ?? 'remote'}
      data-expanded={expanded}
      className="flex min-w-0 flex-col border-b border-border last:border-b-0"
    >
      <div className="flex min-w-0 items-center gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            data-testid="machine-toggle"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-ui font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
          >
            <ChevronRight
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                'size-3.5 flex-none text-content-tertiary transition-transform duration-(--dur-fast)',
                expanded && 'rotate-90',
              )}
            />
            <span data-testid="machine-item-name" className="truncate">
              <MachineName machine={machine} all={machines} />
            </span>
            {chief.host && (
              <span
                data-orchestration="host"
                className="flex-none text-meta font-normal text-content-tertiary"
              >
                {t('Coordinator 主机')}
              </span>
            )}
          </button>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 pl-5 text-meta">
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
            <button
              type="button"
              data-testid="machine-open-runtime"
              onClick={() => onOpenSection('runtime')}
              className="cursor-pointer border-0 bg-transparent p-0 text-meta text-content-tertiary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
            >
              {t('运行时')} ›
            </button>
            {machine.capabilities !== undefined && (
              <>
                <span aria-hidden className="text-content-dim">
                  ·
                </span>
                <button
                  type="button"
                  data-testid="machine-open-capabilities"
                  onClick={() => onOpenSection('capabilities')}
                  className="cursor-pointer border-0 bg-transparent p-0 text-meta text-content-tertiary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
                >
                  {t('能力')} ›
                </button>
              </>
            )}
          </div>
        </div>
        <ToggleSwitch
          data-testid="machine-accept-toggle"
          aria-label={t('{name} 接任务', { name: machine.name })}
          checked={enabled}
          disabled={!canMutate || mutations.patchMachine.isPending}
          title={
            online ? undefined : t('重新连接 {name} 后才能修改它的设置。', { name: machine.name })
          }
          onCheckedChange={setAccepting}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="machine-menu"
                aria-label={t('{name} 的菜单', { name: machine.name })}
              />
            }
          >
            <Ellipsis aria-hidden strokeWidth={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-40">
            <DropdownMenuItem
              data-testid="machine-menu-evacuate"
              disabled={others.length === 0}
              onClick={() => setEvacuateOpen(true)}
            >
              {t('整机迁移')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="machine-menu-delete"
              disabled={deleting || homeAgents.length > 0}
              title={
                homeAgents.length > 0
                  ? t('先迁走归属这台机器的 {n} 个 agent 才能删除。', { n: homeAgents.length })
                  : t('删除后，这台机器要重新注册才能再接任务。')
              }
              onClick={() => setConfirmOpen(true)}
            >
              {t('删除机器')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded && (
        <div id={bodyId} ref={bodyRef}>
          <MachineDetailPane
            machine={machine}
            machines={machines}
            chief={chief}
            fixture={fixture}
            search={search}
            pending={mutations.patchMachine.isPending}
            onToggleRuntime={toggleRuntime}
            membersQ={membersQ}
            homeAgents={homeAgents}
          />
        </div>
      )}
      <AlertDialogShell
        title={t('整机迁移')}
        subtitle={t('把归属这台机器的 agent 一起迁到另一台机器。')}
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
              disabled={evacuateTarget === null || evacuating || homeAgents.length === 0}
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
        title={t('确定删除这台机器？此操作不可撤销。')}
        summary={machine.name}
        ariaLabel={t('删除机器')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
