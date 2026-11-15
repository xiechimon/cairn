import type { ComputerRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Laptop, MonitorSmartphone, Plus, Server } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../api/auth.js';
import { useConnected } from '../api/connection-state.js';
import { useComputers } from '../api/hooks.js';
import { clockTime } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { useComputerControl } from '../api/use-computer-control.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { ListCard } from '../components/list-card.js';
import { QueryBoundary, type QueryLike, queryPhase } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { settingsHref } from '../settings/settings-href.js';
import { CoordinatorComputer } from './computer-feed.js';
import { MachineScreenSurface } from './computer-screen.js';
import { ComputerControlBar, ComputerScreenDialog } from './computer-screen-dialog.js';
import { fleetStatus, fleetStatusLine, machineStateLabel } from './fleet-status.js';
import { desktopControlOnline } from './machine-capabilities.js';
import { joinMeta, relativeTime } from './rel-time.js';

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
      <Icon aria-hidden="true" className="size-5.5" />
      <StatusDot
        online={machine.online === true}
        className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
      />
    </span>
  );
}

const COMPUTERS_PANEL_REFRESH_MS = 5_000;

function machineMeta(machine: MachineRow, now: number, t: TFunc): string {
  if (machine.online !== true) {
    const seen = machine.lastSeenAt ?? 0;
    return seen > 0 ? joinMeta([t('离线'), relativeTime(seen, now, t)]) : t('离线');
  }
  const running = machine.runningSteps ?? 0;
  return running === 0 ? t('空闲') : t('{n} 个在跑', { n: running });
}

export function MachineChip({
  machines,
  open,
  onToggle,
  round = false,
}: {
  machines: readonly MachineRow[];
  open: boolean;
  onToggle: () => void;
  round?: boolean;
}) {
  const { t } = useI18n();
  const connected = useConnected();
  const host = coordinatorMachine(machines);
  const fleet = fleetStatus(machines);
  const label = joinMeta([
    t('电脑'),
    host?.name,
    host === null ? null : connected ? machineStateLabel(host, t) : t('连接断开，正在重连…'),
    fleetStatusLine(fleet, t),
  ]);
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
          className={cn(
            'relative text-content-tertiary hover:text-foreground data-[connected=false]:opacity-60 aria-pressed:bg-(--hover-1) aria-pressed:text-foreground',
            round &&
              'size-11.5 rounded-full bg-popover text-foreground shadow-(--e2) hover:bg-popover dark:hover:bg-popover aria-pressed:bg-(--hover-1) dark:aria-pressed:bg-(--hover-1)',
          )}
        />
      }
    >
      <Laptop aria-hidden="true" className={round ? 'size-5.5' : undefined} />
      {fleet.online + fleet.offline > 0 && (
        <span
          aria-hidden="true"
          data-slot="fleet-badge"
          data-fleet={fleet.offline > 0 ? 'offline' : 'online'}
          className={cn(
            'absolute size-2 rounded-full ring-2',
            round ? 'right-2.5 bottom-3 ring-popover' : 'right-1 bottom-1.5 ring-background',
            fleet.online === 0
              ? cn(
                  'rounded-full border bg-background',
                  fleet.offline > 0 ? 'border-destructive' : 'border-content-tertiary',
                )
              : fleet.offline > 0
                ? 'bg-destructive'
                : 'bg-running',
          )}
        />
      )}
    </IconTooltip>
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
  render,
}: {
  icon: ReactNode;
  label: string;
  render: ReactElement;
}) {
  return (
    <ListCard outlined className="flex-none">
      <Button variant="ghost" render={render} className={cn(ROW_CLS, LINE_ROW_CLS)}>
        <span className="flex flex-none text-content-secondary">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{label}</span>
      </Button>
    </ListCard>
  );
}

function MachineCard({
  machine,
  computer,
  teamId,
  openScreen,
}: {
  machine: MachineRow;
  computer: ComputerRecord | null;
  teamId: string | undefined;
  openScreen: boolean;
}) {
  const { t } = useI18n();
  const [fullscreen, setFullscreen] = useState(false);
  const [screenRequested, setScreenRequested] = useState(openScreen);
  const control = useComputerControl({ teamId, computer });
  const screenLive =
    computer !== null && teamId !== undefined && desktopControlOnline(machine, computer);

  useEffect(() => {
    if (!screenLive) setFullscreen(false);
  }, [screenLive]);

  useEffect(() => {
    if (!screenRequested || !screenLive) return;
    setFullscreen(true);
    setScreenRequested(false);
  }, [screenRequested, screenLive]);

  const takeOver = () => {
    control.setHeld(true);
    setFullscreen(true);
  };

  return (
    <div data-testid="machine-card" className="flex flex-col divide-y divide-border">
      <div className="flex min-h-13 items-center gap-5 py-2 pr-2 pl-5">
        <MachineGlyph machine={machine} />
        <span data-testid="machine-list-row" className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui text-foreground">{machine.name}</span>
          <span className="truncate text-meta text-content-tertiary">
            {machineMeta(machine, Date.now(), t)}
          </span>
        </span>
        {machine.id !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="machine-edit"
            aria-label={`${t('编辑')} ${machine.name}`}
            render={
              <Link
                to={{
                  pathname: settingsHref('machines'),
                  search: new URLSearchParams({ machine: machine.id }).toString(),
                }}
              />
            }
            className="h-7 flex-none px-2 text-ui font-normal text-foreground"
          >
            {t('编辑')}
          </Button>
        )}
      </div>
      {screenLive ? (
        <>
          <MachineScreenSurface
            teamId={teamId}
            computer={computer}
            leaseId={control.leaseId}
            interactive={false}
            onExpand={() => setFullscreen(true)}
          />
          <ComputerControlBar
            held={control.controlHeld}
            busy={control.busy}
            handoff={computer.handoffReason}
            onTakeOver={takeOver}
            onGiveBack={() => control.setHeld(false)}
          />
          {fullscreen && (
            <ComputerScreenDialog
              open
              onClose={() => setFullscreen(false)}
              title={machine.name}
              teamId={teamId}
              computer={computer}
              control={control}
            />
          )}
        </>
      ) : (
        machine.online === true && (
          <p
            data-testid="machine-screen-hint"
            className="m-0 flex items-center gap-2 py-2 pr-4 pl-5 text-meta text-content-tertiary"
          >
            <MonitorSmartphone aria-hidden="true" className="size-4 flex-none" />
            {t('未开启桌面控制，开启后这里显示屏幕')}
          </p>
        )
      )}
    </div>
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
  const computersQ = useComputers(teamId, live && !auth.gateOpen, COMPUTERS_PANEL_REFRESH_MS);
  const params = new URLSearchParams(search);
  const linkedMachine = params.get('screen') === '1' ? params.get('machine') : null;
  const computers = computersQ.data ?? [];
  const host = coordinatorMachine(machines);
  const ordered = host === null ? machines : [host, ...machines.filter((m) => m !== host)];
  const machinesPhase = queryPhase(query, machines.length === 0);
  const computerFor = (machine: MachineRow): ComputerRecord | null =>
    computers.find((computer) => computer.machine.id === machine.id) ?? null;
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const keyOf = (machine: MachineRow) => machine.id ?? machine.name;

  const recheck = () => {
    setChecking(true);
    void Promise.all([query?.refetch(), computersQ.refetch()]).finally(() => {
      setCheckedAt(Date.now());
      setChecking(false);
    });
  };

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
              <MachineCard
                key={keyOf(machine)}
                machine={machine}
                computer={computerFor(machine)}
                teamId={teamId}
                openScreen={linkedMachine !== null && keyOf(machine) === linkedMachine}
              />
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
                className="size-4 text-content-tertiary"
              />
            ) : (
              t('再检查一次')
            )}
          </Button>
        </div>
        <div data-testid="machines-add" className="mt-7">
          <LineRow
            icon={<Plus aria-hidden="true" className="size-5.5" />}
            label={t('添加电脑')}
            render={<Link to={settingsHref('machines')} />}
          />
        </div>
        {ordered.length <= 1 && machinesPhase !== 'loading' && machinesPhase !== 'error' && (
          <p className="m-0 px-2.5 pt-3 text-meta text-content-tertiary">
            {t('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。')}
          </p>
        )}
        {host !== null && (
          <div className="mt-7">
            <CoordinatorComputer />
          </div>
        )}
      </div>
    </SidePanel>
  );
}
