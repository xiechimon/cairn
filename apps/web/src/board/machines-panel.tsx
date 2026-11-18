import type { ComputerRecord, ComputerState, VmDownload } from '@cairn/shared';
import { cn } from 'cn';
import { Laptop, Monitor, Plus } from 'lucide-react';
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
import { MachineIcon, MachineName } from '../components/machine-label.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { settingsHref } from '../settings/settings-href.js';
import {
  ComputerActionsMenu,
  computerActionNoteText,
  useComputerActions,
} from './computer-actions-menu.js';
import { MachineScreenSurface } from './computer-screen.js';
import { ComputerScreenDialog } from './computer-screen-dialog.js';
import { fleetStatus, fleetStatusLine, machineStateLabel } from './fleet-status.js';
import { desktopControlOnline } from './machine-capabilities.js';
import { joinMeta, relativeTime } from './rel-time.js';
import { useScreenHoverControl } from './screen-hover-control.js';
import { ThreadLink } from './thread-link.js';

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
  return (
    <span className="relative flex flex-none text-content-secondary">
      <MachineIcon machine={machine} className="size-5.5" />
      <StatusDot
        online={machine.online === true}
        className="absolute -right-0.5 -bottom-0.5 ring-2 ring-background"
      />
    </span>
  );
}

const COMPUTERS_PANEL_REFRESH_MS = 5_000;

const COMPUTER_STATE_LABEL: Record<ComputerState, string> = {
  stopped: '关着',
  starting: '正在开机',
  running: '开着',
  failed: '出错',
};

function machineMeta(machine: MachineRow, now: number, t: TFunc): string {
  if (machine.online !== true) {
    const seen = machine.lastSeenAt ?? 0;
    return seen > 0 ? joinMeta([t('离线'), relativeTime(seen, now, t)]) : t('离线');
  }
  return machineStateLabel(machine, t);
}

function MachineMeta({
  machine,
  computer,
}: {
  machine: MachineRow;
  computer: ComputerRecord | null;
}) {
  const { t } = useI18n();
  const base = machineMeta(machine, Date.now(), t);
  if (computer === null || machine.online !== true) return <>{base}</>;
  return (
    <>
      {`${base} · `}
      <span data-testid="computer-state" data-state={computer.state}>
        {t(COMPUTER_STATE_LABEL[computer.state])}
      </span>
    </>
  );
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

const LINE_ROW_CLS = 'h-9 py-0 pointer-coarse:h-11';

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

export function formatDownloadBytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function VmDownloadSurface({
  download,
  starting,
  onDownload,
}: {
  download: VmDownload;
  starting: boolean;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const state = starting && download.state !== 'downloading' ? 'downloading' : download.state;
  const total = formatDownloadBytes(download.totalBytes);
  const percent = Math.round((download.doneBytes / download.totalBytes) * 100);
  return (
    <div
      data-testid="vm-download"
      data-state={state}
      className="grid aspect-[16/10] place-items-center bg-(--surface-1) p-6"
    >
      <div className="flex w-full max-w-60 flex-col items-center gap-1 text-center">
        <Monitor aria-hidden="true" className="mb-1 size-5.5 text-content-secondary" />
        <span className="text-ui font-medium text-foreground">{t('Linux 虚拟机')}</span>
        {state === 'downloading' ? (
          <>
            <span className="text-meta text-content-tertiary tabular-nums">
              {`${formatDownloadBytes(download.doneBytes)} / ${total}`}
            </span>
            <div
              role="progressbar"
              aria-label={t('Linux 虚拟机')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-3 h-1 w-full overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-content-tertiary"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <span
              className={cn(
                'text-meta tabular-nums',
                state === 'failed' ? 'text-destructive' : 'text-content-tertiary',
              )}
            >
              {state === 'failed' ? t('下载没完成') : total}
            </span>
            <Button
              size="sm"
              data-testid="vm-download-start"
              className="mt-3 px-2.5 pointer-coarse:h-11 pointer-coarse:px-6"
              onClick={onDownload}
            >
              {state === 'failed' ? t('重试') : t('下载')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function MachineActivity({
  machine,
  computer,
}: {
  machine: MachineRow;
  computer: ComputerRecord | null;
}) {
  const { t } = useI18n();
  const activity = computer?.activity ?? null;
  if (machine.online !== true || activity === null) return null;
  const time = relativeTime(activity.at, Date.now(), t);
  const linkCls =
    'min-w-0 truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50';
  const subject =
    activity.todoId === null ? (
      <Link to="/app" className={linkCls}>
        {t('Coordinator')}
      </Link>
    ) : (
      <ThreadLink todoId={activity.todoId} className={linkCls}>
        {activity.title}
      </ThreadLink>
    );
  return (
    <p
      data-testid="machine-activity"
      data-activity={activity.inUse ? 'using' : 'idle'}
      className={cn(
        'm-0 flex min-w-0 items-baseline gap-1 px-5 py-2.5 text-meta',
        activity.inUse ? 'text-content-secondary' : 'text-content-tertiary',
      )}
    >
      {activity.inUse ? (
        <>
          {subject}
          <span className="flex-none">{t('· 正在用 · {time}', { time })}</span>
        </>
      ) : (
        <>
          <span className="flex-none">{t('空闲 · 上次')}</span>
          {subject}
          <span className="flex-none">{t('· {time}', { time })}</span>
        </>
      )}
    </p>
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
  const hover = useScreenHoverControl(control, computer?.handoffReason != null);
  const actions = useComputerActions(teamId, computer);
  const download = computer?.download?.state === 'ready' ? null : (computer?.download ?? null);
  const screenLive =
    computer !== null &&
    download === null &&
    teamId !== undefined &&
    desktopControlOnline(machine, computer);
  const installing = actions.note?.kind === 'running' && actions.note.action === 'install';

  useEffect(() => {
    if (!screenLive) setFullscreen(false);
  }, [screenLive]);

  useEffect(() => {
    if (!screenRequested || !screenLive) return;
    setFullscreen(true);
    setScreenRequested(false);
  }, [screenRequested, screenLive]);

  return (
    <div data-testid="machine-card" className="flex flex-col divide-y divide-border">
      <div className="flex min-h-13 items-center gap-5 py-2 pr-2 pl-5">
        <MachineGlyph machine={machine} />
        <span data-testid="machine-list-row" className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 text-ui text-foreground">
            <MachineName machine={machine} showIcon={false} />
          </span>
          <span className="truncate text-meta text-content-tertiary">
            <MachineMeta machine={machine} computer={computer} />
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
            className="h-7 flex-none px-2 text-ui font-normal text-foreground pointer-coarse:h-11"
          >
            {t('编辑')}
          </Button>
        )}
        {computer?.kind === 'vm' && download === null && (
          <ComputerActionsMenu
            machineName={machine.name}
            disabled={actions.pending || machine.online !== true}
            onAction={actions.run}
          />
        )}
      </div>
      {actions.note !== null && !(download !== null && 'action' in actions.note) && (
        <p
          role="status"
          data-testid="computer-action-note"
          data-note={actions.note.kind}
          title={actions.note.kind === 'failed' ? actions.note.detail : undefined}
          className={cn(
            'm-0 px-5 py-2 text-meta',
            actions.note.kind === 'failed' ? 'text-destructive' : 'text-content-secondary',
          )}
        >
          {computerActionNoteText(actions.note, t)}
        </p>
      )}
      {download !== null && machine.online === true && (
        <VmDownloadSurface
          download={download}
          starting={installing}
          onDownload={() => actions.run('install')}
        />
      )}
      {screenLive && (
        <>
          <MachineScreenSurface
            teamId={teamId}
            computer={computer}
            leaseId={control.leaseId}
            interactive={false}
            onExpand={() => setFullscreen(true)}
          />
          {(computer.handoffReason !== null || control.failed) && (
            <p
              data-testid="machine-screen-note"
              className={cn(
                'm-0 px-5 py-2 text-meta',
                control.failed ? 'text-destructive' : 'text-foreground',
              )}
            >
              {control.failed ? t('没能接管，电脑没有响应') : t('需要你登录')}
            </p>
          )}
          {fullscreen && (
            <ComputerScreenDialog
              onClose={() => setFullscreen(false)}
              title={machine.name}
              teamId={teamId}
              computer={computer}
              control={control}
              hover={hover}
            />
          )}
        </>
      )}
      <MachineActivity machine={machine} computer={computer} />
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
          <div className="flex flex-none flex-col gap-3">
            {ordered.map((machine) => (
              <ListCard key={keyOf(machine)} outlined className="flex-none">
                <MachineCard
                  machine={machine}
                  computer={computerFor(machine)}
                  teamId={teamId}
                  openScreen={linkedMachine !== null && keyOf(machine) === linkedMachine}
                />
              </ListCard>
            ))}
          </div>
        </QueryBoundary>
        <div className="flex h-11 flex-none items-center justify-between pr-2 pl-2.5 text-meta text-content-tertiary">
          <span>{t('{time} 检查过', { time: clockTime(checkedAt) })}</span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="machines-recheck"
            aria-label={t('再检查一次')}
            aria-busy={checking}
            disabled={checking}
            onClick={recheck}
            className="h-7 min-w-16 px-2 text-ui font-normal text-foreground pointer-coarse:h-11 disabled:opacity-100"
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
        <div data-testid="machines-add" className="mt-1">
          <LineRow
            icon={<Plus aria-hidden="true" className="size-5.5" />}
            label={t('添加电脑')}
            render={<Link to={settingsHref('machines')} />}
          />
        </div>
      </div>
    </SidePanel>
  );
}
