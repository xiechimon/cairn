import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Laptop, MonitorSmartphone, Plus, Server } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../api/auth.js';
import {
  acquireComputerControl,
  releaseComputerControl,
  renewComputerControl,
} from '../api/computer-screen.js';
import { useComputers } from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { useLiveData } from '../api/provider.js';
import { ListCard } from '../components/list-card.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';
import { CoordinatorComputer } from './computer-feed.js';
import { MachineScreenSurface, ScreenPlaceholder } from './computer-screen.js';
import { machineStateLabel } from './fleet-status.js';
import { desktopControlInstalled, desktopControlOnline } from './machine-capabilities.js';

export function coordinatorMachine(machines: readonly MachineRow[]): MachineRow | null {
  return (
    machines.find((machine) => machine.chiefHost === true) ??
    machines.find((machine) => machine.kind === 'local') ??
    machines[0] ??
    null
  );
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
  const hostOnline = host?.online === true;
  const running = hostOnline ? (host?.runningSteps ?? 0) : 0;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={open}
      onClick={onToggle}
      data-testid="machines-button"
      title={host === null ? undefined : `${host.name} · ${machineStateLabel(host, t)}`}
      className="mr-1 h-7 gap-1.5 rounded-full px-2.5 text-meta font-normal text-content-secondary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
    >
      <Laptop aria-hidden="true" className="size-3.5" />
      <span className="max-w-32 truncate max-[640px]:sr-only">{host?.name ?? t('电脑')}</span>
      <OnlineDot online={host?.online === true} />
      {host != null && !hostOnline && (
        <span className="text-content-tertiary max-[640px]:hidden">{t('离线')}</span>
      )}
      {running > 0 && (
        <span className="text-content-tertiary tabular-nums max-[640px]:hidden">
          {t('{n} 在跑', { n: running })}
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
  onExpand,
}: {
  machine: MachineRow;
  computer: ComputerRecord | null;
  teamId: string | undefined;
  leaseId: string | null;
  interactive: boolean;
  onExpand?: () => void;
}) {
  const { t } = useI18n();
  if (computer !== null && teamId !== undefined && desktopControlOnline(machine, computer)) {
    return (
      <MachineScreenSurface
        teamId={teamId}
        computer={computer}
        leaseId={leaseId}
        interactive={interactive}
        onExpand={onExpand}
      />
    );
  }
  return null;
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
  const [expanded, setExpanded] = useState(false);
  const [expandAfterLease, setExpandAfterLease] = useState(false);
  const reclaiming = useRef(false);
  const controlHeld = leaseId !== null || computer?.controlHolder === 'user';
  const canToggleDesktop =
    desktopInstalled && online && computer !== null && teamId !== undefined && !busy;
  const screenLive =
    computer !== null && teamId !== undefined && desktopControlOnline(machine, computer);

  useEffect(() => {
    if (computer?.controlHolder === 'user') return;
    setLeaseId(null);
  }, [computer?.controlHolder, computer?.id]);

  useEffect(() => {
    if (!screenLive) {
      setExpanded(false);
      setExpandAfterLease(false);
    }
  }, [screenLive]);

  useEffect(() => {
    if (
      teamId === undefined ||
      computer === null ||
      computer.controlHolder !== 'user' ||
      leaseId !== null ||
      reclaiming.current
    )
      return;
    const computerId = computer.id;
    reclaiming.current = true;
    setBusy(true);
    void acquireComputerControl(teamId, computerId)
      .then((lease) => {
        setLeaseId(lease.leaseId);
        return invalidateConverged(qc, { queryKey: ['computers', teamId] });
      })
      .finally(() => {
        reclaiming.current = false;
        setBusy(false);
      });
  }, [teamId, computer?.id, computer?.controlHolder, leaseId, qc, computer]);

  useEffect(() => {
    if (teamId === undefined || computer === null || leaseId === null) return;
    const tick = window.setInterval(() => {
      void renewComputerControl(teamId, computer.id, leaseId).catch(() => {
        setLeaseId(null);
      });
    }, 10 * 60_000);
    return () => window.clearInterval(tick);
  }, [teamId, computer, leaseId]);

  useEffect(() => {
    if (!expandAfterLease || leaseId === null) return;
    setExpanded(true);
    setExpandAfterLease(false);
  }, [expandAfterLease, leaseId]);

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
        : acquireComputerControl(teamId, computer.id).then((lease) =>
            releaseComputerControl(teamId, computer.id, lease.leaseId).then(() => {
              setLeaseId(null);
            }),
          );
    void run
      .then(() => invalidateConverged(qc, { queryKey: ['computers', teamId] }))
      .finally(() => setBusy(false));
  };

  const openEnlarged = () => {
    if (!screenLive || teamId === undefined || computer === null) return;
    if (leaseId !== null) {
      setExpanded(true);
      return;
    }
    setExpandAfterLease(true);
    if (busy) return;
    setBusy(true);
    void acquireComputerControl(teamId, computer.id)
      .then((lease) => {
        setLeaseId(lease.leaseId);
        return invalidateConverged(qc, { queryKey: ['computers', teamId] });
      })
      .catch(() => {
        setExpandAfterLease(false);
      })
      .finally(() => setBusy(false));
  };

  return (
    <ListCard className="flex-none">
      {expanded && screenLive ? (
        <ScreenPlaceholder online label={t('屏幕已放大')} />
      ) : (
        <MachineScreen
          machine={machine}
          computer={computer}
          teamId={teamId}
          leaseId={leaseId}
          interactive={false}
          onExpand={screenLive ? openEnlarged : undefined}
        />
      )}
      {expanded && screenLive && computer !== null && teamId !== undefined && (
        <DialogShell
          bare
          open={expanded}
          onClose={() => setExpanded(false)}
          title={machine.name}
          width="min(100vw - 1.5rem, 1280px)"
          height="min(100dvh - 1.5rem, 900px)"
          className="flex max-h-[calc(100dvh-1.5rem)] flex-col"
        >
          <div className="relative flex shrink-0 items-start gap-3 px-4 pt-4 pr-12 pb-2 sm:px-5 sm:pt-4.5 sm:pr-13">
            <div className="min-w-0 flex-1">
              <div className="font-heading text-heading leading-[1.4] font-title text-foreground">
                {machine.name}
              </div>
              <p className="mt-0.5 text-meta text-content-tertiary">
                {leaseId !== null ? t('在大屏里点击和键入') : t('打开桌面控制后再操作')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3 text-content-tertiary hover:text-foreground sm:top-4 sm:right-4"
              aria-label={t('关闭')}
              onClick={() => setExpanded(false)}
            >
              <X width={16} height={16} />
            </Button>
          </div>
          <div
            data-testid="machine-screen-enlarged"
            className="grid min-h-0 flex-1 place-items-center px-2 pb-2 sm:px-3 sm:pb-3"
            style={{ containerType: 'size' }}
          >
            <div
              className="max-h-full max-w-full"
              style={{
                aspectRatio: '16 / 10',
                width: 'min(100cqw, calc(100cqh * 16 / 10))',
                height: 'min(100cqh, calc(100cqw * 10 / 16))',
              }}
            >
              <MachineScreenSurface
                teamId={teamId}
                computer={computer}
                leaseId={leaseId}
                interactive={leaseId !== null}
                fill
                autoFocus
              />
            </div>
          </div>
        </DialogShell>
      )}
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
            {machineStateLabel(machine, t)}
          </span>
        </span>
      </div>
      {online && !screenLive && (
        <p
          data-testid="machine-screen-hint"
          className="m-0 flex items-center gap-2 px-3.5 pb-1 text-meta text-content-tertiary"
        >
          <MonitorSmartphone aria-hidden="true" className="size-3.5 flex-none" />
          {t('未开启桌面控制，开启后这里显示屏幕')}
        </p>
      )}
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
