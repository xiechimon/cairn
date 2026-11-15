import type { DesktopUpdateBlocker, DesktopUpdateState } from '@cairn/shared';
import { CircleArrowUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { useI18n } from '../i18n/provider.js';

interface DesktopUpdateBridge {
  state: () => Promise<DesktopUpdateState | null>;
  check: () => Promise<void>;
  install: () => Promise<void>;
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void;
}

function desktopUpdates(): DesktopUpdateBridge | null {
  const desktop = (window as Window & { cairnDesktop?: { update?: DesktopUpdateBridge } })
    .cairnDesktop;
  return desktop?.update ?? null;
}

const BLOCKER_HINTS: Record<DesktopUpdateBlocker, string> = {
  development: '开发版不检查更新',
  'not-in-applications': '把 Cairn 移到「应用程序」后才能自动更新',
  'read-only': 'Cairn 所在的文件夹不可写，无法自动更新',
};

const PILL = 'h-7 gap-1.5 rounded-full pr-2.5 pl-2 text-meta';

export function DesktopUpdateButton({
  iconClassName,
  idleClassName,
}: {
  iconClassName: string;
  idleClassName: string;
}) {
  const { t } = useI18n();
  const [bridge] = useState(desktopUpdates);
  const [state, setState] = useState<DesktopUpdateState>({ status: 'idle' });

  useEffect(() => {
    if (bridge === null) return;
    void bridge.state().then((initial) => {
      if (initial !== null) setState(initial);
    });
    return bridge.subscribe(setState);
  }, [bridge]);

  if (bridge === null) return null;
  const icon = <CircleArrowUp className={iconClassName} strokeWidth={1.75} />;

  if (state.status === 'available') {
    return (
      <Button data-testid="desktop-update" className={PILL} onClick={() => void bridge.install()}>
        {icon}
        {t('更新到 {version}', { version: state.version })}
      </Button>
    );
  }
  if (state.status === 'downloading' || state.status === 'installing') {
    return (
      <Button data-testid="desktop-update" variant="secondary" className={PILL} disabled>
        {icon}
        {state.status === 'downloading'
          ? t('正在更新 {percent}%', { percent: state.percent })
          : t('正在重启…')}
      </Button>
    );
  }

  const label =
    state.status === 'unsupported'
      ? t(BLOCKER_HINTS[state.blocker])
      : state.status === 'checking'
        ? t('正在检查更新…')
        : state.status === 'current'
          ? t('已是最新版本 {version}', { version: state.version })
          : state.status === 'error'
            ? t('更新失败：{message}', { message: state.message })
            : t('检查更新');
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="desktop-update"
            aria-label={label}
            className={idleClassName}
            disabled={state.status === 'checking' || state.status === 'unsupported'}
            onClick={() => void bridge.check()}
          >
            {icon}
          </Button>
        }
      />
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
