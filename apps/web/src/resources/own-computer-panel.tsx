import type {
  HostPermissions,
  OwnComputerGrant,
  OwnComputerInstallFailure,
  OwnComputerInstallResult,
} from '@cairn/shared';
import { cn } from 'cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApiMutations, useOwnComputerGrants, useRevokeOwnComputerGrant } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { ChevronDown } from '../icons/index.js';

interface OwnComputerBridge {
  install: () => Promise<OwnComputerInstallResult | null>;
  guide: () => Promise<boolean | null>;
  permissions: () => Promise<HostPermissions | null>;
}

function ownComputerBridge(): OwnComputerBridge | undefined {
  return (window as Window & { cairnDesktop?: { ownComputer?: OwnComputerBridge } }).cairnDesktop
    ?.ownComputer;
}

export type InstallState =
  | 'idle'
  | 'installing'
  | 'installed'
  | OwnComputerInstallFailure
  | 'unsupported';

export type OwnComputerPanelState =
  | 'off'
  | 'finish-in-app'
  | 'installing'
  | 'install-failed'
  | 'not-installed'
  | 'verifying'
  | 'no-accessibility'
  | 'no-screen-recording'
  | 'ready';

const SETTLED = new Set(['granted', 'not_required']);
const NEEDS_ACTION = new Set<OwnComputerPanelState>([
  'install-failed',
  'not-installed',
  'no-accessibility',
  'no-screen-recording',
]);
const EXPANDABLE = new Set<OwnComputerPanelState>([...NEEDS_ACTION, 'ready']);

export function ownComputerPanelState(input: {
  enabled: boolean;
  host: boolean;
  verified: boolean;
  inMacApp: boolean;
  install: InstallState;
  permissions: HostPermissions | undefined;
}): OwnComputerPanelState {
  if (!input.enabled) return 'off';
  if (!input.inMacApp && !input.host) return 'finish-in-app';
  if (input.install === 'installing') return 'installing';
  if (input.install !== 'idle' && input.install !== 'installed') return 'install-failed';
  if (!input.verified) {
    if (!input.inMacApp) return 'finish-in-app';
    return input.install === 'installed' ? 'verifying' : 'not-installed';
  }
  if (input.permissions?.accessibility !== 'granted') return 'no-accessibility';
  if (!SETTLED.has(input.permissions.screenRecording)) return 'no-screen-recording';
  return 'ready';
}

export function shouldShowOwnComputer(machine: MachineRow): boolean {
  return (
    machine.capabilities?.ownComputerHost === true ||
    machine.ownComputerEnabled === true ||
    (machine.kind === 'local' && machine.capabilities?.osPlatform === 'darwin')
  );
}

function installFailureText(reason: InstallState, t: TFunc): string {
  switch (reason) {
    case 'network':
      return t('没能下载 agent-desktop，检查网络后重试');
    case 'checksum':
      return t('下载的 agent-desktop 校验不通过，没有安装');
    case 'archive':
      return t('agent-desktop 安装包不完整，没有安装');
    case 'version':
      return t('下载的 agent-desktop 版本不对，没有安装');
    case 'disk':
      return t('没能写入 Runner 的工具目录，检查磁盘空间后重试');
    default:
      return t('这台 Mac 的处理器不受 agent-desktop 支持');
  }
}

function stateText(state: OwnComputerPanelState, t: TFunc): string {
  switch (state) {
    case 'off':
      return t(
        '开启后，Coordinator 可以在这台 Mac 上以你的身份读取文件和运行程序；每个应用和每条命令第一次用都会先问你',
      );
    case 'finish-in-app':
      return t('在这台 Mac 上打开 Cairn 应用完成设置');
    case 'installing':
      return t('正在安装 agent-desktop');
    case 'not-installed':
      return t('agent-desktop 还没装在这台 Mac 上');
    case 'verifying':
      return t('正在等 Runner 确认 agent-desktop');
    case 'no-accessibility':
      return t('Cairn 还没有“辅助功能”权限');
    case 'no-screen-recording':
      return t('Cairn 没有“屏幕录制”权限：Coordinator 只能以文字读取应用');
    case 'ready':
      return t('你批准后，Coordinator 可以使用这台 Mac 上的应用');
    default:
      return '';
  }
}

function stateSegment(state: OwnComputerPanelState, grants: number, t: TFunc): string | null {
  switch (state) {
    case 'off':
      return null;
    case 'finish-in-app':
      return t('在 Cairn 应用里完成设置');
    case 'installing':
      return t('正在安装 agent-desktop');
    case 'verifying':
      return t('正在确认 agent-desktop');
    case 'not-installed':
      return t('还没装 agent-desktop');
    case 'install-failed':
      return t('安装失败');
    case 'no-accessibility':
      return t('缺“辅助功能”权限');
    case 'no-screen-recording':
      return t('缺“屏幕录制”权限');
    case 'ready':
      return grants > 0 ? t('{n} 项授权', { n: grants }) : t('还没授权');
  }
}

function grantLabel(grant: OwnComputerGrant, t: TFunc): string {
  return grant.kind === 'shell' ? t('命令 {key}', { key: grant.key }) : grant.key;
}

function grantScope(grant: OwnComputerGrant, t: TFunc): string {
  if (grant.kind === 'shell') return t('所有对话');
  return grant.threadTitle === null
    ? t('一个对话')
    : t('对话「{title}」', { title: grant.threadTitle });
}

export function useOwnComputerRow(machine: MachineRow): {
  state: OwnComputerPanelState | null;
  meta: ReactNode;
  control: ReactNode;
  drawer: ReactNode;
} {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const fixture = machine.ownComputerFixture;
  const bridge = live ? ownComputerBridge() : undefined;
  const inMacApp = live ? bridge !== undefined : fixture?.inMacApp === true;
  const enabled = machine.ownComputerEnabled === true;
  const [install, setInstall] = useState<InstallState>(fixture?.install ?? 'idle');
  const [localPermissions, setLocalPermissions] = useState<HostPermissions | null>(null);
  const [checking, setChecking] = useState(false);
  const grantsQ = useOwnComputerGrants(machine.id, live && enabled);
  const revoke = useRevokeOwnComputerGrant(machine.id);
  const grants = live ? (grantsQ.data ?? []) : (fixture?.grants ?? []);
  const verified = machine.capabilities?.ownComputer === true;
  const permissions = localPermissions ?? machine.capabilities?.hostPermissions;
  const state = ownComputerPanelState({
    enabled,
    host: machine.capabilities?.ownComputerHost === true,
    verified,
    inMacApp,
    install,
    permissions,
  });
  const [open, setOpen] = useState<boolean | null>(null);
  const prevState = useRef(state);
  if (prevState.current !== state) {
    prevState.current = state;
    setOpen(null);
  }
  const expanded = open ?? NEEDS_ACTION.has(state);

  const runInstall = async () => {
    if (bridge === undefined) return;
    setInstall('installing');
    const result = await bridge.install().catch(() => null);
    setInstall(result === null ? 'disk' : result.ok ? 'installed' : result.reason);
  };

  const recheck = async () => {
    if (bridge === undefined) return;
    setChecking(true);
    try {
      setLocalPermissions(await bridge.permissions());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!enabled || !verified || bridge === undefined) return;
    void bridge.permissions().then(setLocalPermissions, () => undefined);
  }, [enabled, verified, bridge]);

  const toggle = (next: boolean) => {
    if (!live || machine.id === undefined) {
      blockDemoWrite();
      return;
    }
    mutations.patchMachine.mutate(
      { id: machine.id, body: { ownComputerEnabled: next } },
      {
        onSuccess: () => {
          if (next && bridge !== undefined && !verified) void runInstall();
        },
        onError: (error) =>
          toastError(
            next ? t('没能开启，请在这台 Mac 上的 Cairn 应用里重试') : t('没能关闭，请重试'),
            error,
          ),
      },
    );
  };

  if (!shouldShowOwnComputer(machine)) {
    return { state: null, meta: null, control: null, drawer: null };
  }

  const failed = state === 'install-failed';
  const segment = stateSegment(state, grants.length, t);
  const expandable = EXPANDABLE.has(state);
  const segmentCls = failed
    ? 'text-destructive'
    : NEEDS_ACTION.has(state)
      ? 'text-(--waiting-ink)'
      : 'text-content-tertiary';
  const meta =
    segment === null ? null : (
      <>
        <span aria-hidden className="text-content-dim">
          ·
        </span>
        {expandable ? (
          <Button
            variant="ghost"
            data-testid="own-computer-meta"
            aria-expanded={expanded}
            onClick={() => setOpen(!expanded)}
            className={cn(
              'h-auto min-h-0 gap-0.5 rounded-sm px-0 py-0 text-meta font-normal whitespace-nowrap hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-(--focus-ring) dark:hover:bg-transparent pointer-coarse:min-h-11',
              segmentCls,
            )}
          >
            {segment}
            <ChevronDown
              aria-hidden
              className={cn(
                'size-3 flex-none transition-transform duration-(--dur-fast)',
                expanded && 'rotate-180',
              )}
            />
          </Button>
        ) : (
          <span data-testid="own-computer-meta" className={cn('whitespace-nowrap', segmentCls)}>
            {segment}
          </span>
        )}
      </>
    );

  const switchEl = (
    <ToggleSwitch
      id={`own-computer-${machine.id ?? machine.name}`}
      data-testid="own-computer-switch"
      checked={enabled}
      disabled={mutations.patchMachine.isPending}
      onCheckedChange={(next) => toggle(next)}
      aria-label={t('让 Coordinator 使用这台 Mac')}
    />
  );
  const control =
    state === 'off' ? (
      <Tooltip>
        <TooltipTrigger render={switchEl} />
        <TooltipContent side="top" sideOffset={8} className="max-w-72">
          {stateText('off', t)}
        </TooltipContent>
      </Tooltip>
    ) : (
      switchEl
    );

  const drawer =
    !expandable || !expanded ? null : (
      <div
        data-testid="own-computer-drawer"
        className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-2"
      >
        <p
          data-testid="own-computer-status"
          role={failed ? 'alert' : 'status'}
          className={cn('m-0 text-meta', failed ? 'text-destructive' : 'text-content-secondary')}
        >
          {failed ? installFailureText(install, t) : stateText(state, t)}
        </p>
        {(failed || state === 'not-installed') && (
          <div>
            <Button
              variant="outline"
              size="sm"
              data-testid="own-computer-install"
              disabled={bridge === undefined}
              onClick={() => void runInstall()}
            >
              {failed ? t('重试') : t('安装')}
            </Button>
          </div>
        )}
        {(state === 'no-accessibility' || state === 'no-screen-recording') && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="own-computer-guide"
              disabled={bridge === undefined}
              onClick={() => void bridge?.guide()}
            >
              {t('打开系统设置')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="own-computer-recheck"
              disabled={bridge === undefined || checking}
              aria-busy={checking}
              onClick={() => void recheck()}
            >
              {t('再检查一次')}
            </Button>
          </div>
        )}
        {(state === 'ready' || state === 'no-screen-recording') && grants.length > 0 && (
          <ul data-testid="own-computer-grants" className="m-0 flex list-none flex-col p-0">
            {grants.map((grant) => (
              <li
                key={grant.proposalId}
                data-testid="own-computer-grant"
                className="flex min-w-0 items-center gap-3 py-1"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui text-foreground">{grantLabel(grant, t)}</span>
                  <span className="truncate text-meta text-content-tertiary">
                    {grantScope(grant, t)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="own-computer-revoke"
                  disabled={revoke.isPending}
                  onClick={() => {
                    if (!live) {
                      blockDemoWrite();
                      return;
                    }
                    revoke.mutate(grant.proposalId, {
                      onError: (error) => toastError(t('没能撤销，请重试'), error),
                    });
                  }}
                >
                  {t('撤销')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  return { state, meta, control, drawer };
}
