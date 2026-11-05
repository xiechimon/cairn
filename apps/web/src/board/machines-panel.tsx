import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Laptop, MonitorSmartphone, Plus, Server } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../api/auth.js';
import { acquireComputerControl, releaseComputerControl } from '../api/computer-screen.js';
import { useComputers } from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { useLiveData } from '../api/provider.js';
import { ListCard } from '../components/list-card.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { CoordinatorComputer } from './computer-feed.js';
import { MachineScreenSurface, ScreenPlaceholder } from './computer-screen.js';
import { desktopControlInstalled, desktopControlOnline } from './machine-capabilities.js';

export function coordinatorMachine(machines: readonly MachineRow[]): MachineRow | null {
  return (
    machines.find((machine) => machine.chiefHost === true) ??
    machines.find((machine) => machine.kind === 'local') ??
    machines[0] ??
    null
  );
}

function runningLabel(machine: MachineRow, t: ReturnType<typeof useI18n>['t']): string {
  if (machine.online !== true) return t('离线');
  const running = machine.runningSteps ?? 0;
  if (running === 0) return t('空闲');
  return machine.maxConcurrent != null
    ? t('{n}/{max} 在跑', { n: running, max: machine.maxConcurrent })
    : t('{n} 在跑', { n: running });
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-1.5 flex-none rounded-full ${online ? 'bg-running' : 'bg-content-dim'}`}
    />
  );
}

export function MachineChip({
  machines,
  open,
  onToggle,
}: {
  machines: readonly MachineRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const host = coordinatorMachine(machines);
  const running = machines.reduce((sum, machine) => sum + (machine.runningSteps ?? 0), 0);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={open}
      onClick={onToggle}
      data-testid="machines-button"
      className="mr-1 h-7 gap-1.5 rounded-full px-2.5 text-meta font-normal text-content-secondary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
    >
      <Laptop aria-hidden="true" className="size-3.5" />
      <span className="max-w-32 truncate max-[640px]:sr-only">{host?.name ?? t('电脑')}</span>
      <OnlineDot online={host?.online === true} />
      {running > 0 && (
        <span className="text-content-tertiary tabular-nums max-[640px]:hidden">
          {t('{n} 在跑', { n: running })}
        </span>
      )}
      {machines.length > 1 && (
        <span className="text-content-tertiary tabular-nums max-[640px]:hidden">
          +{machines.length - 1}
        </span>
      )}
    </Button>
  );
}

function CapabilityRow({
  icon,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="flex-none text-content-tertiary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui text-foreground">{label}</span>
        <span className="text-meta text-content-tertiary">{hint}</span>
      </span>
      <ToggleSwitch
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function MachineScreen({
  machine,
  computer,
  teamId,
  leaseId,
  interactive,
}: {
  machine: MachineRow;
  computer: ComputerRecord | null;
  teamId: string | undefined;
  leaseId: string | null;
  interactive: boolean;
}) {
  const { t } = useI18n();
  const online = machine.online === true;
  if (computer !== null && teamId !== undefined && desktopControlOnline(machine, computer)) {
    return (
      <MachineScreenSurface
        teamId={teamId}
        computer={computer}
        leaseId={leaseId}
        interactive={interactive}
      />
    );
  }
  if (!online) return <ScreenPlaceholder online={false} label={t('电脑离线')} />;
  if (desktopControlOnline(machine, computer)) {
    return <ScreenPlaceholder online label={t('桌面控制已上线，屏幕显示在这里')} />;
  }
  return <ScreenPlaceholder online label={t('屏幕随桌面控制一起上线，到时显示在这里')} />;
}

function MachineCard({
  machine,
  coordinator,
  computer,
  teamId,
}: {
  machine: MachineRow;
  coordinator: boolean;
  computer: ComputerRecord | null;
  teamId: string | undefined;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const online = machine.online === true;
  const Icon = machine.kind === 'local' ? Laptop : Server;
  const desktopInstalled = desktopControlInstalled(machine, computer);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controlHeld = leaseId !== null || computer?.controlHolder === 'user';
  const canToggleDesktop =
    desktopInstalled &&
    online &&
    computer !== null &&
    teamId !== undefined &&
    !busy &&
    (leaseId !== null || computer.controlHolder !== 'user');

  useEffect(() => {
    if (computer?.controlHolder === 'user') return;
    setLeaseId(null);
  }, [computer?.controlHolder, computer?.id]);

  const onDesktopToggle = (checked: boolean) => {
    if (teamId === undefined || computer === null || busy) return;
    setBusy(true);
    const run = checked
      ? acquireComputerControl(teamId, computer.id).then((lease) => {
          setLeaseId(lease.leaseId);
        })
      : leaseId !== null
        ? releaseComputerControl(teamId, computer.id, leaseId).then(() => {
            setLeaseId(null);
          })
        : Promise.resolve();
    void run
      .then(() => invalidateConverged(qc, { queryKey: ['computers', teamId] }))
      .finally(() => setBusy(false));
  };

  return (
    <ListCard className="flex-none">
      <MachineScreen
        machine={machine}
        computer={computer}
        teamId={teamId}
        leaseId={leaseId}
        interactive={leaseId !== null}
      />
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Icon aria-hidden="true" className="size-4.5 flex-none text-content-secondary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-medium text-foreground">{machine.name}</span>
            {coordinator && (
              <Badge variant="secondary" className="font-normal">
                {t('Coordinator 在这台')}
              </Badge>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-meta text-content-tertiary">
            <OnlineDot online={online} />
            {runningLabel(machine, t)}
          </span>
        </span>
      </div>
      <CapabilityRow
        icon={<MonitorSmartphone aria-hidden="true" className="size-4" />}
        label={t('桌面控制')}
        hint={t('让 agent 操作这台电脑上的应用。macOS 要在辅助功能里授权。')}
        checked={desktopInstalled && controlHeld}
        disabled={!canToggleDesktop}
        onCheckedChange={canToggleDesktop ? onDesktopToggle : undefined}
      />
      <CapabilityRow
        icon={<Globe aria-hidden="true" className="size-4" />}
        label={t('浏览器')}
        hint={t('让 agent 打开网页、点击和填表。')}
        checked={false}
        disabled
      />
    </ListCard>
  );
}

export function MachinesPanel({
  machines,
  onClose,
}: {
  machines: readonly MachineRow[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const auth = useAuth();
  const computersQ = useComputers(teamId, live && !auth.gateOpen);
  const computers = computersQ.data ?? [];
  const host = coordinatorMachine(machines);
  const ordered = host === null ? machines : [host, ...machines.filter((m) => m !== host)];
  const computerFor = (machine: MachineRow): ComputerRecord | null =>
    computers.find((computer) => computer.machine.id === machine.id) ?? null;
  return (
    <SidePanel label={t('电脑')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('电脑')}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 pb-4">
        {ordered.length <= 1 && (
          <p className="m-0 px-1 text-meta text-content-tertiary">
            {t('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。')}
          </p>
        )}
        <CoordinatorComputer />
        {ordered.map((machine) => (
          <MachineCard
            key={machine.id ?? machine.name}
            machine={machine}
            coordinator={machine === host}
            computer={computerFor(machine)}
            teamId={teamId}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-meta text-content-secondary"
          render={<Link to="/app/resources/machines" />}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {t('添加电脑')}
        </Button>
      </div>
    </SidePanel>
  );
}
