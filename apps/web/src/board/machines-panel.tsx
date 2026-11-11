import type { ComputerRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { Folder, Laptop, MonitorSmartphone, Plus, Server } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
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
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { ExplainDisabledToggle, ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Spinner } from '../components/ui/spinner.js';
import type { MachineRow } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ChevronLeft, ChevronRight, X } from '../icons/index.js';
import { settingsHref } from '../settings/settings-href.js';
import { CoordinatorComputer } from './computer-feed.js';
import { MachineScreenSurface, ScreenPlaceholder } from './computer-screen.js';
import { machineStateLabel } from './fleet-status.js';
import {
  browserCapabilityInstalled,
  desktopControlInstalled,
  desktopControlOnline,
} from './machine-capabilities.js';
import { joinMeta, relativeTime } from './rel-time.js';
import { useOpenThread } from './thread-link.js';
import { useProjectNames } from './work-panel.js';

export function coordinatorMachine(machines: readonly MachineRow[]): MachineRow | null {
  return (
    machines.find((machine) => machine.chiefHost === true) ??
    machines.find((machine) => machine.kind === 'local') ??
    machines[0] ??
    null
  );
}

function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="machine-status-dot"
      data-online={online}
      className={cn(
        'block size-1.5 flex-none rounded-full',
        online ? 'bg-running' : 'rounded-full border border-content-tertiary bg-background',
        className,
      )}
    />
  );
}

function MachineGlyph({ machine }: { machine: MachineRow }) {
  const Icon = machine.kind === 'local' ? Laptop : Server;
  return (
    <span className="relative flex flex-none text-content-secondary">
      <Icon aria-hidden="true" className="size-4.5" />
      <StatusDot
        online={machine.online === true}
        className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
      />
    </span>
  );
}

const MINUTE_MS = 60_000;
const MINUTES_SHOWN = 180;

function checkedAgo(ts: number | null | undefined, now: number, t: TFunc): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return '';
  const minutes = Math.floor((now - ts) / MINUTE_MS);
  if (minutes < 1) return t('刚刚检查过');
  if (minutes < MINUTES_SHOWN) return t('{n} 分钟前检查过', { n: minutes });
  return t('{time}检查过', { time: relativeTime(ts, now, t) });
}

function machineMeta(machine: MachineRow, t: TFunc): string {
  if (machine.online !== true) return checkedAgo(machine.lastSeenAt, Date.now(), t) || t('离线');
  if (machine.folders === undefined) return machineStateLabel(machine, t);
  return joinMeta([t('在线'), t('{n} 个文件夹', { n: machine.folders.length })]);
}

function MachineDetailStatus({
  machine,
  coordinator,
}: {
  machine: MachineRow;
  coordinator: boolean;
}) {
  const { t } = useI18n();
  const online = machine.online === true;
  const seen = online ? '' : checkedAgo(machine.lastSeenAt, Date.now(), t);
  const text = joinMeta([
    online ? t('在线') : t('离线'),
    seen,
    coordinator ? t('Coordinator 在这台') : '',
  ]);
  return (
    <div className="flex flex-col gap-2 px-2.5">
      {machine.hostname !== undefined && (
        <p data-testid="machine-hostname" className="m-0 text-meta text-content-tertiary">
          {t('它自称')} <span className="font-mono">{machine.hostname}</span>
        </p>
      )}
      <p
        data-testid="machine-detail-status"
        className="m-0 flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary"
      >
        <StatusDot online={online} />
        <span className="truncate">{text}</span>
      </p>
    </div>
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
    <div className="flex items-center gap-5 py-2.5 pr-4 pl-5">
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
  const [tab, setTab] = useState<DetailTab>('access');
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

  const screen = screenLive && (
    <ListCard outlined className="flex-none">
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
  );
  const enlarged = expanded && screenLive && computer !== null && teamId !== undefined && (
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
  );

  return (
    <>
      <div className="mt-7 flex flex-none">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          label={machine.name}
          className="h-7 w-full p-0.5 group-data-horizontal/tabs:h-7"
          optionHandle="h-6 flex-1 text-foreground data-active:font-normal dark:text-foreground"
          options={[
            { value: 'work', label: t('在这台工作'), testId: 'machine-tab-work' },
            { value: 'access', label: t('Agent 的权限'), testId: 'machine-tab-access' },
          ]}
        />
      </div>
      {tab === 'work' ? (
        <div data-testid="machine-work" className="flex flex-col gap-3">
          <RunningHere machine={machine} />
          {screen}
          {online && !screenLive && (
            <p
              data-testid="machine-screen-hint"
              className="m-0 flex items-center gap-2 px-2.5 text-meta text-content-tertiary"
            >
              <MonitorSmartphone aria-hidden="true" className="size-3.5 flex-none" />
              {t('未开启桌面控制，开启后这里显示屏幕')}
            </p>
          )}
          {coordinator && <CoordinatorComputer />}
        </div>
      ) : (
        <div data-testid="machine-access" className="flex flex-col">
          {machine.folders !== undefined && (
            <>
              <SectionLabel className="mt-10">{t('Agent 在这台电脑上能用的文件夹')}</SectionLabel>
              <ListCard outlined className="flex-none">
                {machine.folders.length === 0 ? (
                  <p className="m-0 py-2 pr-4 pl-5 text-ui text-content-tertiary">
                    {t('还没有开放任何文件夹')}
                  </p>
                ) : (
                  machine.folders.map((folder) => (
                    <div
                      key={folder.path}
                      data-testid="machine-folder"
                      className="flex h-9 items-center gap-5 pr-5 pl-5"
                    >
                      <Folder
                        aria-hidden="true"
                        className="size-4.5 flex-none text-content-secondary"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-ui text-foreground">
                        {folder.path}
                      </span>
                      <span className="flex-none text-meta text-content-tertiary">
                        {folder.enabled ? t('已开放') : t('未开放')}
                      </span>
                    </div>
                  ))
                )}
              </ListCard>
            </>
          )}
          <SectionLabel className={machine.folders === undefined ? 'mt-10' : 'mt-7'}>
            {t('能力')}
          </SectionLabel>
          <ListCard outlined className="flex-none">
            <CapabilityRow
              label={t('浏览器')}
              hint={browserHint}
              checked={browserEnabled}
              disabled={!canToggleBrowser}
              disabledReason={browserHint}
              onCheckedChange={canToggleBrowser ? onBrowserToggle : undefined}
            />
            <CapabilityRow
              label={t('桌面控制')}
              hint={t('让 agent 操作这台电脑上的应用。macOS 要在辅助功能里授权。')}
              checked={desktopInstalled && controlHeld}
              disabled={!canToggleDesktop}
              disabledReason={desktopBlockedReason}
              onCheckedChange={canToggleDesktop ? onDesktopToggle : undefined}
            />
          </ListCard>
        </div>
      )}
      {enlarged}
    </>
  );
}

type DetailTab = 'work' | 'access';

function RunningHere({ machine }: { machine: MachineRow }) {
  const { t } = useI18n();
  const openThread = useOpenThread();
  const projectNames = useProjectNames();
  const now = Date.now();
  const running = machine.runningHere;
  if (running === undefined || running.length === 0) {
    const count =
      machine.online === true && running === undefined ? (machine.runningSteps ?? 0) : 0;
    return (
      <p
        data-testid="machine-running-empty"
        className="m-0 px-2.5 pt-9 pb-5 text-center text-ui text-content-tertiary"
      >
        {count > 0
          ? t('这台电脑上有 {n} 个任务在跑。', { n: count })
          : t('这台电脑上现在没有在跑的任务。')}
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      <SectionLabel className="mt-10">{t('正在这台电脑上跑')}</SectionLabel>
      <ListCard outlined className="flex-none">
        {running.map((thread) => (
          <Button
            key={thread.threadId}
            variant="ghost"
            data-testid="machine-running-row"
            onClick={() => openThread(thread.threadId)}
            className={ROW_CLS}
          >
            <span className="flex size-4.5 flex-none items-center justify-center">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-running" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-ui text-foreground">{thread.title}</span>
              <span className="truncate text-meta text-content-tertiary">
                {joinMeta([
                  projectNames.get(thread.projectId),
                  t('{time}开始', { time: relativeTime(thread.startedAt, now, t) }),
                ])}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 flex-none text-content-tertiary" />
          </Button>
        ))}
      </ListCard>
    </div>
  );
}

function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h3 className={cn('m-0 px-2.5 pb-1 text-ui font-normal text-foreground', className)}>
      {children}
    </h3>
  );
}

const ROW_CLS =
  'h-auto w-full justify-start gap-5 rounded-none py-2 pr-4 pl-5 text-left font-normal whitespace-normal hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';

const LINE_ROW_CLS = 'h-9 py-0';

function LineRow({
  icon,
  label,
  chevron = false,
  onClick,
  render,
}: {
  icon: ReactNode;
  label: string;
  chevron?: boolean;
  onClick?: () => void;
  render?: ReactElement;
}) {
  return (
    <ListCard outlined className="flex-none">
      <Button
        variant="ghost"
        onClick={onClick}
        render={render}
        className={cn(ROW_CLS, LINE_ROW_CLS)}
      >
        <span className="flex flex-none text-content-secondary">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{label}</span>
        {chevron && (
          <ChevronRight aria-hidden="true" className="size-4 flex-none text-content-tertiary" />
        )}
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
  const { search } = useLocation();
  const computersQ = useComputers(teamId, live && !auth.gateOpen);
  const computers = computersQ.data ?? [];
  const host = coordinatorMachine(machines);
  const ordered = host === null ? machines : [host, ...machines.filter((m) => m !== host)];
  const machinesPhase = queryPhase(query, machines.length === 0);
  const computerFor = (machine: MachineRow): ComputerRecord | null =>
    computers.find((computer) => computer.machine.id === machine.id) ?? null;
  const [openKey, setOpenKey] = useState<string | null>(() =>
    live ? null : (resolveScenario(new URLSearchParams(search)).machinesOpen ?? null),
  );
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
                className="-ml-1.5 text-content-secondary hover:text-foreground"
                onClick={() => setOpenKey(null)}
              />
            }
          >
            <ChevronLeft aria-hidden="true" className="size-4.5" />
          </IconTooltip>
          <h2 className="m-0 min-w-0 flex-1 truncate text-heading font-normal text-foreground">
            {selected.name}
          </h2>
          {selected.id !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="machine-edit"
              render={
                <Link
                  to={{
                    pathname: settingsHref('machines'),
                    search: new URLSearchParams({ machine: selected.id }).toString(),
                  }}
                />
              }
              className="h-7 px-2 text-ui font-normal text-foreground"
            >
              {t('编辑')}
            </Button>
          )}
        </SidePanelHead>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-6">
          <MachineDetailStatus machine={selected} coordinator={selected === host} />
          <MachineDetail
            key={keyOf(selected)}
            machine={selected}
            coordinator={selected === host}
            computer={computerFor(selected)}
            pinnedElsewhere={computers.some(
              (row) => selected.id !== undefined && row.machine.id !== selected.id,
            )}
            teamId={teamId}
          />
          <div className="mt-7">
            <LineRow
              icon={<Laptop aria-hidden="true" className="size-4.5" />}
              label={t('所有电脑')}
              chevron
              onClick={() => setOpenKey(null)}
            />
          </div>
        </div>
      </SidePanel>
    );
  }

  return (
    <SidePanel label={t('电脑')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('电脑')}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-1 pb-6">
        <SectionLabel>{t('你的电脑')}</SectionLabel>
        <QueryBoundary
          query={query}
          isEmpty={machines.length === 0}
          loadingLabel={t('正在加载电脑')}
          errorTitle={t('电脑没能加载')}
          empty={null}
        >
          <ListCard outlined className="flex-none">
            {ordered.map((machine) => (
              <Button
                key={keyOf(machine)}
                variant="ghost"
                onClick={() => setOpenKey(keyOf(machine))}
                className={ROW_CLS}
              >
                <MachineGlyph machine={machine} />
                <span data-testid="machine-list-row" className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui text-foreground">{machine.name}</span>
                  <span className="truncate text-meta text-content-tertiary">
                    {machineMeta(machine, t)}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 flex-none text-content-tertiary"
                />
              </Button>
            ))}
          </ListCard>
        </QueryBoundary>
        <div className="flex h-13 flex-none items-center justify-between pr-2 pl-4 text-meta text-content-tertiary">
          <span>{t('{time} 检查过', { time: clockTime(checkedAt) })}</span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="machines-recheck"
            aria-label={t('再检查一次')}
            aria-busy={checking}
            disabled={checking}
            onClick={recheck}
            className="h-7 min-w-16 px-2 text-ui font-normal text-foreground disabled:opacity-100"
          >
            {checking ? (
              <Spinner
                role="presentation"
                aria-hidden="true"
                className="size-3.5 text-content-tertiary"
              />
            ) : (
              t('再检查一次')
            )}
          </Button>
        </div>
        <div data-testid="machines-add" className="mt-7">
          <LineRow
            icon={<Plus aria-hidden="true" className="size-4.5" />}
            label={t('添加电脑')}
            render={<Link to={settingsHref('machines')} />}
          />
        </div>
        {ordered.length <= 1 && machinesPhase !== 'loading' && machinesPhase !== 'error' && (
          <p className="m-0 px-2.5 pt-3 text-meta text-content-tertiary">
            {t('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。')}
          </p>
        )}
      </div>
    </SidePanel>
  );
}
