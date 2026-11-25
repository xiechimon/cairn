import type { HostPermissions } from '@cairn/shared';
import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLiveData } from '../api/provider.js';
import { UpdateCairnNotice } from '../board/desktop-update.js';
import { Button } from '../components/ui/button.js';
import { ownComputerBridge, ownComputerCapabilityState } from '../desktop-shell.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export type OwnComputerPanelState =
  | 'not-in-app'
  | 'no-accessibility'
  | 'no-screen-recording'
  | 'ready';

const SETTLED = new Set(['granted', 'not_required']);
const NEEDS_ACTION = new Set<OwnComputerPanelState>(['no-accessibility', 'no-screen-recording']);

export function ownComputerPanelState(input: {
  screen: boolean;
  permissions: HostPermissions | undefined;
}): OwnComputerPanelState {
  if (!input.screen) return 'not-in-app';
  if (input.permissions?.accessibility !== 'granted') return 'no-accessibility';
  if (!SETTLED.has(input.permissions.screenRecording)) return 'no-screen-recording';
  return 'ready';
}

export function shouldShowOwnComputer(machine: MachineRow): boolean {
  return (
    machine.kind === 'local' &&
    (machine.capabilities?.ownComputer === true ||
      machine.capabilities?.ownComputerShell === true ||
      machine.capabilities?.osPlatform === 'darwin')
  );
}

type NeedsAttention = Exclude<OwnComputerPanelState, 'ready'>;

function stateText(state: NeedsAttention, t: TFunc): string {
  switch (state) {
    case 'not-in-app':
      return t('在这台 Mac 上打开 Cairn 应用后，Coordinator 才能使用它的应用');
    case 'no-accessibility':
      return t(
        'Cairn 尚未获得“辅助功能”权限：Coordinator 能在这台 Mac 上运行命令，但不能读取或操作应用',
      );
    case 'no-screen-recording':
      return t('Cairn 没有“屏幕录制”权限：Coordinator 只能以文字读取应用');
  }
}

function stateSegment(state: NeedsAttention, t: TFunc): string {
  switch (state) {
    case 'not-in-app':
      return t('在 Cairn 应用里打开');
    case 'no-accessibility':
      return t('缺“辅助功能”权限');
    case 'no-screen-recording':
      return t('缺“屏幕录制”权限');
  }
}

export function useOwnComputerRow(machine: MachineRow): {
  state: OwnComputerPanelState | null;
  meta: ReactNode;
  drawer: ReactNode;
} {
  const { t } = useI18n();
  const { live } = useLiveData();
  const shown = shouldShowOwnComputer(machine);
  const capability = live ? ownComputerCapabilityState() : 'allowed';
  const bridge = live ? ownComputerBridge() : undefined;
  const [localPermissions, setLocalPermissions] = useState<HostPermissions | null>(null);
  const [checking, setChecking] = useState(false);
  const screen = machine.capabilities?.ownComputer === true;
  const permissions = localPermissions ?? machine.capabilities?.hostPermissions;
  const state = ownComputerPanelState({ screen, permissions });
  const [open, setOpen] = useState<boolean | null>(null);
  const prevState = useRef(state);
  if (prevState.current !== state) {
    prevState.current = state;
    setOpen(null);
  }
  const expanded = open ?? NEEDS_ACTION.has(state);

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
    if (!screen || bridge === undefined) return;
    void bridge.permissions().then(setLocalPermissions, () => undefined);
  }, [screen, bridge]);

  if (!shown) return { state: null, meta: null, drawer: null };
  if (state === 'ready') return { state, meta: null, drawer: null };

  const segment = stateSegment(state, t);
  const segmentCls = NEEDS_ACTION.has(state) ? 'text-(--waiting-ink)' : 'text-content-tertiary';
  const meta = (
    <>
      <span aria-hidden className="text-content-dim">
        ·
      </span>
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
            'size-4 flex-none transition-transform duration-(--dur-fast)',
            expanded && 'rotate-180',
          )}
        />
      </Button>
    </>
  );

  const drawer = !expanded ? null : (
    <div
      data-testid="own-computer-drawer"
      className="flex min-w-0 flex-col gap-2 border-t border-border px-4 py-2"
    >
      <p
        data-testid="own-computer-status"
        role="status"
        className="m-0 text-meta text-content-secondary"
      >
        {stateText(state, t)}
      </p>
      {NEEDS_ACTION.has(state) &&
        (live && capability === 'needs-update' ? (
          <UpdateCairnNotice
            message={t('更新 Cairn 后即可在这里授权并检查。')}
            buttonTestId="own-computer-update-cairn"
          />
        ) : live && capability === 'hidden' ? null : (
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
        ))}
    </div>
  );

  return { state, meta, drawer };
}
