import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Laptop, MonitorSmartphone, Plus, Server } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../api/auth.js';
import {
  acquireComputerControl,
  ensureComputerBrowser,
  patchComputerBrowser,
  releaseComputerControl,
  renewComputerControl,
} from '../api/computer-screen.js';
import { useConnected } from '../api/connection-state.js';
import { useComputers } from '../api/hooks.js';
import { invalidateConverged } from '../api/invalidate.js';
import { clockTime } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { ListCard } from '../components/list-card.js';
import { QueryBoundary, type QueryLike, queryPhase } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Skeleton } from '../components/ui/skeleton.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, ChevronRight, X } from '../icons/index.js';
import { CoordinatorComputer } from './computer-feed.js';
import { MachineScreenSurface, ScreenPlaceholder } from './computer-screen.js';
import { machineStateLabel } from './fleet-status.js';
import {
  browserCapabilityInstalled,
  desktopControlInstalled,
  desktopControlOnline,
} from './machine-capabilities.js';
import { relativeTime } from './rel-time.js';

export function coordinatorMachine(machines: readonly MachineRow[]): MachineRow | null {
  return (
    machines.find((machine) => machine.chiefHost === true) ??
    machines.find((machine) => machine.kind === 'local') ??
    machines[0] ??
    null
  );
}

function MachineStatus({ machine, coordinator }: { machine: MachineRow; coordinator: boolean }) {
  const { t } = useI18n();
  const online = machine.online === true;
  const seen = online ? '' : relativeTime(machine.lastSeenAt, Date.now(), t);
  const state = online
    ? machineStateLabel(machine, t)
    : seen === ''
      ? t('离线')
      : `${t('离线')} · ${t('最后在线 {time}', { time: seen })}`;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary">
      {online && <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-running" />}
      <span className="truncate">
        {coordinator ? `${state} · ${t('Coordinator 在这台')}` : state}
      </span>
    </span>
  );
}

export function MachineChip({
  machines,
  open,
  onToggle,
  loading = false,
}: {
  machines: readonly MachineRow[];
  open: boolean;
  onToggle: () => void;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const connected = useConnected();
  const host = coordinatorMachine(machines);
  const hostOnline = connected && host?.online === true;
  const label =
    host === null
      ? t('电脑')
      : `${t('电脑')} · ${host.name} · ${connected ? machineStateLabel(host, t) : t('连接断开，正在重连…')}`;
  return (
    <IconTooltip
      label={label}
      side="bottom"
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={open}
          onClick={onToggle}
          data-testid="machines-button"
          data-connected={connected}
          className="relative text-content-tertiary hover:text-foreground data-[connected=false]:opacity-60 aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
        />
      }
    >
      <Laptop aria-hidden="true" />
      {loading ? (
        <Skeleton className="absolute top-1 right-1 size-1.5 animate-none rounded-full" />
      ) : (
        hostOnline && (
          <span
            aria-hidden="true"
            data-testid="machines-online-dot"
            className="absolute top-1 right-1 size-1.5 rounded-full bg-running"
          />
        )
      )}
    </IconTooltip>
  );
}

function CapabilityRow({
  label,
  hint,
  checked,
  disabled,
  disabledReason,
  onCheckedChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const reason = disabled ? (disabledReason ?? hint) : undefined;
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui text-foreground">{label}</span>
        <span className="text-meta text-content-tertiary">{hint}</span>
      </span>
      <ExplainDisabledToggle disabled={disabled} reason={reason}>
        <ToggleSwitch
          checked={checked}
          disabled={disabled}
          aria-label={label}
          title={reason}
          onCheckedChange={onCheckedChange}
        />
      </ExplainDisabledToggle>
    </div>
  );
}

function MachineDetail({
  machine,
  coordinator,
  computer,
  pinnedElsewhere,
  teamId,
}: {
  machine: MachineRow;
  coordinator: boolean;
  computer: ComputerRecord | null;
  pinnedElsewhere: boolean;
  teamId: string | undefined;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const online = machine.online === true;
  const desktopInstalled = desktopControlInstalled(machine, computer);
  const browserInstalled = browserCapabilityInstalled(machine, computer);
  const [leaseId, setLeaseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandAfterLease, setExpandAfterLease] = useState(false);
  const reclaiming = useRef(false);
  const controlHeld = leaseId !== null || computer?.controlHolder === 'user';
  const canToggleDesktop =
    desktopInstalled && online && computer !== null && teamId !== undefined && !busy;
  const browserEnabled = computer?.browserEnabled === true;
  const browserPinnedElsewhere = pinnedElsewhere && computer === null;
  const canToggleBrowser =
    teamId !== undefined &&
    machine.id !== undefined &&
    !browserBusy &&
    !browserPinnedElsewhere &&
    (browserInstalled || browserEnabled);
  const browserHint = browserPinnedElsewhere
    ? t('浏览器偏好已绑定到另一台机器。')
    : browserInstalled
      ? t('让 agent 打开网页、点击和填表。')
      : browserEnabled
        ? t('这台机器已不再报告浏览器能力；可关闭已保存的偏好。')
        : t('这台机器还不支持浏览器。');
  const desktopBlockedReason = !online
    ? t('重新连接 {name} 后才能修改它的设置。', { name: machine.name })
    : computer === null
      ? coordinator
        ? t('Coordinator 还没有自己的电脑。第一次需要时会自动开一台。')
        : t('这台机器还没有电脑记录，等桌面控制上线后才能在这里打开。')
      : undefined;
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

  const onBrowserToggle = (checked: boolean) => {
    const machineId = machine.id;
    if (teamId === undefined || machineId === undefined || browserBusy) return;
    if (browserPinnedElsewhere) return;
    if (checked && !browserInstalled) return;
    if (!checked && computer === null) return;
    const ownedTeamId = teamId;
    setBrowserBusy(true);
    const run =
      computer !== null
        ? patchComputerBrowser(computer.id, checked)
        : ensureComputerBrowser(machineId, checked);
    void run
      .then(() => invalidateConverged(qc, { queryKey: ['computers', ownedTeamId] }))
      .catch(() => invalidateConverged(qc, { queryKey: ['computers', ownedTeamId] }))
      .finally(() => setBrowserBusy(false));
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
    <>
      {screenLive && (
        <ListCard className="flex-none">
          {expanded ? (
            <ScreenPlaceholder online label={t('屏幕已放大')} />
          ) : (
            <MachineScreenSurface
              teamId={teamId}
              computer={computer}
              leaseId={leaseId}
              interactive={false}
              onExpand={openEnlarged}
            />
          )}
        </ListCard>
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
      {online && !screenLive && (
        <p
          data-testid="machine-screen-hint"
          className="m-0 flex items-center gap-2 px-1 text-meta text-content-tertiary"
        >
          <MonitorSmartphone aria-hidden="true" className="size-3.5 flex-none" />
          {t('未开启桌面控制，开启后这里显示屏幕')}
        </p>
      )}
      <SectionLabel>{t('能力')}</SectionLabel>
      <ListCard className="flex-none">
        <CapabilityRow
          label={t('浏览器')}
          hint={browserHint}
          checked={browserEnabled}
          disabled={!canToggleBrowser}
          disabledReason={browserHint}
          onCheckedChange={canToggleBrowser ? onBrowserToggle : undefined}
        />
      </ListCard>
      <ListCard className="flex-none">
        <CapabilityRow
          label={t('桌面控制')}
          hint={t('让 agent 操作这台电脑上的应用。macOS 要在辅助功能里授权。')}
          checked={desktopInstalled && controlHeld}
          disabled={!canToggleDesktop}
          disabledReason={desktopBlockedReason}
          onCheckedChange={canToggleDesktop ? onDesktopToggle : undefined}
        />
      </ListCard>
      {coordinator && <CoordinatorComputer />}
    </>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 flex h-8 items-center px-1 text-meta font-medium text-content-tertiary">
      {children}
    </h3>
  );
}

const ROW_CLS =
  'h-auto w-full justify-start gap-3 rounded-none px-3.5 py-3 text-left font-normal whitespace-normal hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

function NavRow({
  icon,
  onClick,
  children,
  render,
}: {
  icon: ReactNode;
  onClick?: () => void;
  children: ReactNode;
  render?: ReactElement;
}) {
  return (
    <ListCard className="flex-none">
      <Button variant="ghost" onClick={onClick} render={render} className={ROW_CLS}>
        <span className="flex-none text-content-secondary">{icon}</span>
        {children}
      </Button>
    </ListCard>
  );
}

export function MachinesPanel({
  machines,
  onClose,
  query,
}: {
  machines: readonly MachineRow[];
  onClose: () => void;
  query?: QueryLike;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const auth = useAuth();
  const computersQ = useComputers(teamId, live && !auth.gateOpen);
  const computers = computersQ.data ?? [];
  const host = coordinatorMachine(machines);
  const ordered = host === null ? machines : [host, ...machines.filter((m) => m !== host)];
  const machinesPhase = queryPhase(query, machines.length === 0);
  const computerFor = (machine: MachineRow): ComputerRecord | null =>
    computers.find((computer) => computer.machine.id === machine.id) ?? null;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const keyOf = (machine: MachineRow) => machine.id ?? machine.name;
  const selected = ordered.find((machine) => keyOf(machine) === openKey) ?? null;

  const recheck = () => {
    setChecking(true);
    void Promise.all([query?.refetch(), computersQ.refetch()]).finally(() => {
      setCheckedAt(Date.now());
      setChecking(false);
    });
  };

  if (selected !== null) {
    return (
      <SidePanel label={t('电脑')} onDismiss={onClose}>
        <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
          <IconTooltip
            label={t('所有电脑')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                className="-ml-2 text-content-tertiary"
                onClick={() => setOpenKey(null)}
              />
            }
          >
            <ChevronLeft aria-hidden="true" />
          </IconTooltip>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="m-0 truncate text-ui font-medium text-foreground">{selected.name}</h2>
            <MachineStatus machine={selected} coordinator={selected === host} />
          </div>
        </SidePanelHead>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pt-3 pb-4">
          <MachineDetail
            machine={selected}
            coordinator={selected === host}
            computer={computerFor(selected)}
            pinnedElsewhere={computers.some(
              (row) => selected.id !== undefined && row.machine.id !== selected.id,
            )}
            teamId={teamId}
          />
          <NavRow
            icon={<Laptop aria-hidden="true" className="size-4" />}
            onClick={() => setOpenKey(null)}
          >
            <span className="min-w-0 flex-1 truncate text-ui text-foreground">{t('所有电脑')}</span>
            <ChevronRight aria-hidden="true" className="size-4 flex-none text-content-dim" />
          </NavRow>
        </div>
      </SidePanel>
    );
  }

  return (
    <SidePanel label={t('电脑')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('电脑')}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pt-1 pb-4">
        <SectionLabel>{t('你的电脑')}</SectionLabel>
        <QueryBoundary
          query={query}
          isEmpty={machines.length === 0}
          loadingLabel={t('正在加载电脑')}
          errorTitle={t('电脑没能加载')}
          empty={null}
        >
          {ordered.map((machine) => (
            <NavRow
              key={keyOf(machine)}
              icon={
                machine.kind === 'local' ? (
                  <Laptop aria-hidden="true" className="size-4.5" />
                ) : (
                  <Server aria-hidden="true" className="size-4.5" />
                )
              }
              onClick={() => setOpenKey(keyOf(machine))}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui font-medium text-foreground">{machine.name}</span>
                <MachineStatus machine={machine} coordinator={machine === host} />
              </span>
              <ChevronRight aria-hidden="true" className="size-4 flex-none text-content-dim" />
            </NavRow>
          ))}
        </QueryBoundary>
        <div className="flex items-center justify-between px-1 pb-2 text-meta text-content-tertiary">
          <span>{t('{time} 检查过', { time: clockTime(checkedAt) })}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={checking}
            onClick={recheck}
            className="h-6.5 text-meta text-foreground"
          >
            {t('再检查一次')}
          </Button>
        </div>
        <NavRow
          icon={<Plus aria-hidden="true" className="size-4" />}
          render={<Link to="/app/resources/machines" />}
        >
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
            {t('添加电脑')}
          </span>
        </NavRow>
        {ordered.length <= 1 && machinesPhase !== 'loading' && machinesPhase !== 'error' && (
          <p className="m-0 px-1 text-meta text-content-tertiary">
            {t('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。')}
          </p>
        )}
      </div>
    </SidePanel>
  );
}
