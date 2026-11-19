import type { ComputerRecord, VmDownload } from '@cairn/shared';
import { cn } from 'cn';
import { Laptop, Monitor, Plus } from 'lucide-react';
import { type FormEvent, type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../api/auth.js';
import { useConnected } from '../api/connection-state.js';
import { useApiMutations, useComputers } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { useComputerControl } from '../api/use-computer-control.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { ListCard } from '../components/list-card.js';
import { MachineIcon, machineDisplayName } from '../components/machine-label.js';
import { QueryBoundary, type QueryLike } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { toastError } from '../components/ui/toaster.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';
import {
  computerActionNoteText,
  MachineMenu,
  useComputerActions,
} from './computer-actions-menu.js';
import { MachineScreenSurface } from './computer-screen.js';
import { ComputerScreenDialog } from './computer-screen-dialog.js';
import { fleetStatus, fleetStatusLine } from './fleet-status.js';
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
        'grow-light block size-1.5 flex-none rounded-full',
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
    host === null ? null : machineDisplayName(host),
    connected ? null : t('连接断开，正在重连…'),
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

function VmDownloadRow({
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
      className="relative flex min-h-14 items-center gap-3 py-2 pr-3 pl-4"
    >
      <Monitor aria-hidden="true" className="size-5.5 flex-none text-content-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-foreground">{t('Linux 虚拟机')}</span>
        <span
          className={cn(
            'truncate text-meta tabular-nums',
            state === 'failed' ? 'text-destructive' : 'text-content-tertiary',
          )}
        >
          {state === 'downloading'
            ? `${formatDownloadBytes(download.doneBytes)} / ${total}`
            : state === 'failed'
              ? t('下载没完成')
              : t('{size}，Coordinator 用它上网和操作软件', { size: total })}
        </span>
      </span>
      {state !== 'downloading' && (
        <Button
          size="sm"
          variant={state === 'failed' ? 'outline' : 'default'}
          data-testid="vm-download-start"
          className="flex-none px-3 pointer-coarse:h-11 pointer-coarse:px-6"
          onClick={onDownload}
        >
          {state === 'failed' ? t('重试') : t('下载')}
        </Button>
      )}
      {state === 'downloading' && (
        <div
          role="progressbar"
          aria-label={t('Linux 虚拟机')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-border"
        >
          <div className="h-full bg-content-tertiary" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

const RENAME_FORM = 'machine-rename-form';

function RenameMachineDialog({
  machineId,
  name,
  onClose,
}: {
  machineId: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { teamId } = useLiveData();
  const { patchMachine } = useApiMutations(teamId);
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const unchanged = trimmed === '' || trimmed === name;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    patchMachine.mutate(
      { id: machineId, body: { name: trimmed } },
      { onSuccess: onClose, onError: (error) => toastError(t('重命名失败，请重试。'), error) },
    );
  };
  return (
    <DialogShell
      title={t('重命名电脑')}
      open
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            type="submit"
            form={RENAME_FORM}
            className={DIALOG_PRIMARY_BUTTON}
            disabled={unchanged || patchMachine.isPending}
          >
            {t('保存')}
          </Button>
        </>
      }
    >
      <form id={RENAME_FORM} onSubmit={submit}>
        <Input
          autoFocus
          maxLength={64}
          data-testid="machine-rename-input"
          aria-label={t('电脑名称')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
    </DialogShell>
  );
}

type CardLine = { kind: 'busy' | 'wait' | 'fail' | 'quiet'; node: ReactNode; title?: string };

function useCardLine({
  machine,
  computer,
  controlFailed,
  note,
}: {
  machine: MachineRow;
  computer: ComputerRecord | null;
  controlFailed: boolean;
  note: ReturnType<typeof useComputerActions>['note'];
}): CardLine | null {
  const { t } = useI18n();
  if (machine.online !== true) {
    const seen = machine.lastSeenAt ?? 0;
    return {
      kind: 'quiet',
      node: seen > 0 ? joinMeta([t('离线'), relativeTime(seen, Date.now(), t)]) : t('离线'),
      title: t('在这台电脑上打开 Cairn，它就会上线'),
    };
  }
  if (note !== null)
    return {
      kind: note.kind === 'failed' ? 'fail' : 'quiet',
      node: (
        <span role="status" data-testid="computer-action-note" data-note={note.kind}>
          {computerActionNoteText(note, t)}
        </span>
      ),
      ...(note.kind === 'failed' ? { title: note.detail } : {}),
    };
  if (controlFailed) return { kind: 'fail', node: t('没能接管，电脑没有响应') };
  if (computer?.state === 'failed') return { kind: 'fail', node: t('电脑卡住了，文件都还在') };
  if (computer?.handoffReason != null)
    return {
      kind: 'wait',
      node: <span data-testid="machine-screen-note">{t('需要你登录，点屏幕接管')}</span>,
    };
  const activity = computer?.activity ?? null;
  if (activity === null || !activity.inUse) return null;
  const linkCls =
    'min-w-0 truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50';
  return {
    kind: 'busy',
    node: (
      <span data-testid="machine-activity" className="flex min-w-0 gap-1">
        {activity.todoId === null ? (
          <Link to="/app" className={linkCls}>
            {t('Coordinator')}
          </Link>
        ) : (
          <ThreadLink todoId={activity.todoId} className={linkCls}>
            {activity.title}
          </ThreadLink>
        )}
        <span className="flex-none">{t('正在用')}</span>
      </span>
    ),
  };
}

const LINE_INK: Record<CardLine['kind'], string> = {
  busy: 'text-content-secondary',
  wait: 'text-(--waiting-ink)',
  fail: 'text-destructive',
  quiet: 'text-content-tertiary',
};

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
  const [renaming, setRenaming] = useState(false);
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
  const vm = computer?.kind === 'vm' && download === null;
  const name = machineDisplayName(machine);
  const line = useCardLine({
    machine,
    computer,
    controlFailed: control.failed,
    note:
      download !== null && actions.note !== null && 'action' in actions.note ? null : actions.note,
  });

  useEffect(() => {
    if (!screenLive) setFullscreen(false);
  }, [screenLive]);

  useEffect(() => {
    if (!screenRequested || !screenLive) return;
    setFullscreen(true);
    setScreenRequested(false);
  }, [screenRequested, screenLive]);

  return (
    <div data-testid="machine-card" className="flex flex-col">
      <div className="flex min-h-14 items-center gap-3 py-2 pr-3 pl-4">
        <MachineGlyph machine={machine} />
        <span data-testid="machine-list-row" className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui text-foreground" title={name}>
            {name}
          </span>
          {line !== null && (
            <span
              data-testid="machine-line"
              data-line={line.kind}
              title={line.title}
              className={cn('flex min-w-0 truncate text-meta tabular-nums', LINE_INK[line.kind])}
            >
              {line.node}
            </span>
          )}
        </span>
        {vm && computer?.state === 'failed' && machine.online === true && (
          <Button
            variant="outline"
            size="sm"
            data-testid="computer-recover"
            disabled={actions.pending}
            className="flex-none px-3 pointer-coarse:h-11"
            onClick={() => actions.run('recover')}
          >
            {t('恢复')}
          </Button>
        )}
        <MachineMenu
          machineName={name}
          settingsHref={
            machine.id === undefined
              ? null
              : `${settingsHref('machines')}?${new URLSearchParams({ machine: machine.id })}`
          }
          onRename={machine.id === undefined ? null : () => setRenaming(true)}
          vm={
            vm
              ? { disabled: actions.pending || machine.online !== true, onAction: actions.run }
              : null
          }
        />
      </div>
      {download !== null && machine.online === true && (
        <div className="border-t border-border">
          <VmDownloadRow
            download={download}
            starting={installing}
            onDownload={() => actions.run('install')}
          />
        </div>
      )}
      {screenLive && (
        <>
          <MachineScreenSurface
            teamId={teamId}
            computer={computer}
            leaseId={control.leaseId}
            interactive={false}
            power={
              computer.state === 'starting'
                ? 'starting'
                : computer.state === 'stopped'
                  ? 'asleep'
                  : 'on'
            }
            {...(computer.handoffReason !== null ? { expandText: t('接管') } : {})}
            onExpand={() => setFullscreen(true)}
          />
          {fullscreen && (
            <ComputerScreenDialog
              onClose={() => setFullscreen(false)}
              title={name}
              teamId={teamId}
              computer={computer}
              control={control}
              hover={hover}
            />
          )}
        </>
      )}
      {renaming && machine.id !== undefined && (
        <RenameMachineDialog
          machineId={machine.id}
          name={name}
          onClose={() => setRenaming(false)}
        />
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
  const computerFor = (machine: MachineRow): ComputerRecord | null =>
    computers.find((computer) => computer.machine.id === machine.id) ?? null;
  const keyOf = (machine: MachineRow) => machine.id ?? machine.name;

  return (
    <SidePanel label={t('电脑')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('电脑')}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-6">
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
        <div data-testid="machines-add">
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
