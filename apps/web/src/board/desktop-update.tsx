import type { DesktopUpdateBlocker, DesktopUpdateState } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { desktopUpdates } from '../desktop-shell.js';
import { EN } from '../i18n/en.js';
import { activeLocale } from '../i18n/locale.js';
import { useI18n } from '../i18n/provider.js';
import { type TFunc, translate } from '../i18n/translate.js';
import { safeLocalStorage } from '../safe-storage.js';

export function canUpdateDesktop(): boolean {
  return desktopUpdates() !== null;
}

function installable(state: DesktopUpdateState | null): boolean {
  return state?.status === 'available' || state?.status === 'ready';
}

const REFUSAL_HINTS: Record<string, string> = {
  'the staged update is not signed by the Cairn certificate': '更新包签名验证未通过，无法安装',
  'the staged update is missing': '安装包已失效，请重新检查更新',
  'another Cairn update is being installed': '另一个更新正在安装中，请稍候',
  'no update is pending to install': '当前没有可安装的更新，请先检查更新',
  'Update installation can only be started from the main Cairn window.':
    '请在 Cairn 主窗口里安装更新',
  'No update is ready to install yet.': '当前没有可安装的更新，请先检查更新',
};

export function updateInstallRefusalCopy(reason: string, t: TFunc): string {
  const mapped = REFUSAL_HINTS[reason];
  if (mapped !== undefined) return t(mapped);
  return t('未能安装更新，点击重试');
}

export async function updateDesktopNow(): Promise<void> {
  const bridge = desktopUpdates();
  if (bridge === null) return;
  const t: TFunc = (source, vars) =>
    translate(activeLocale(safeLocalStorage()), EN, source, vars);
  try {
    if (!installable(await bridge.state())) await bridge.check();
    const current = await bridge.state();
    if (!installable(current)) {
      if (current !== null) toastError(desktopUpdateView(current, t).label, null);
      return;
    }
    const result = await bridge.install();
    if (result !== undefined && !result.ok) {
      toastError(updateInstallRefusalCopy(result.reason, t), null);
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    toastError(updateInstallRefusalCopy(raw, t), null);
  }
}

export interface DesktopUpdateSkewView {
  label: string;
  busy: boolean;
  error: string | null;
}

export function desktopUpdateSkewView(state: DesktopUpdateState, t: TFunc): DesktopUpdateSkewView {
  if (state.status === 'idle' || state.status === 'current' || state.status === 'offline') {
    return { label: t('更新 Cairn'), busy: false, error: null };
  }
  const view = desktopUpdateView(state, t);
  return {
    label: view.label,
    busy: view.busy,
    error: state.status === 'error' ? state.message : null,
  };
}

export function useDesktopUpdateState(): DesktopUpdateState {
  const [bridge] = useState(desktopUpdates);
  const [state, setState] = useState<DesktopUpdateState>({ status: 'idle' });

  useEffect(() => {
    if (bridge === null) return;
    void bridge.state().then((initial) => {
      if (initial !== null) setState(initial);
    });
    return bridge.subscribe(setState);
  }, [bridge]);

  return state;
}

export function UpdateCairnButton({
  size = 'sm',
  variant = 'outline',
  className,
  testId = 'desktop-skew-update',
}: {
  size?: 'xs' | 'sm' | 'default';
  variant?: 'outline' | 'default' | 'ghost';
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const [bridge] = useState(desktopUpdates);
  const state = useDesktopUpdateState();
  const [starting, setStarting] = useState(false);
  if (bridge === null) {
    return (
      <span data-testid={testId} className={cn('text-meta text-content-secondary', className)}>
        {t('请下载安装最新版 Cairn。')}
      </span>
    );
  }
  const view = desktopUpdateSkewView(state, t);
  const busy = starting || view.busy;
  return (
    <Button
      variant={variant}
      size={size}
      data-testid={testId}
      className={cn('flex-none', className)}
      disabled={busy}
      title={view.error ?? undefined}
      onClick={() => {
        if (busy) return;
        setStarting(true);
        void updateDesktopNow().finally(() => setStarting(false));
      }}
    >
      {view.label}
    </Button>
  );
}

export function UpdateCairnNotice({
  message,
  className,
  testId = 'desktop-skew-notice',
  buttonTestId = 'desktop-skew-update',
}: {
  message: string;
  className?: string;
  testId?: string;
  buttonTestId?: string;
}) {
  const { t } = useI18n();
  const [bridge] = useState(desktopUpdates);
  if (bridge === null) {
    return (
      <p data-testid={testId} className={cn('m-0 text-meta text-content-secondary', className)}>
        {t('请下载安装最新版 Cairn。')}
      </p>
    );
  }
  return (
    <div
      data-testid={testId}
      className={cn('flex min-w-0 flex-wrap items-center justify-between gap-2', className)}
    >
      <p className="m-0 min-w-0 flex-1 text-meta text-content-secondary">{message}</p>
      <UpdateCairnButton testId={buttonTestId} />
    </div>
  );
}

const BLOCKER_HINTS: Record<DesktopUpdateBlocker, string> = {
  development: '开发版不检查更新',
  'not-in-applications': '把 Cairn 移到「应用程序」后才能自动更新',
  'read-only': 'Cairn 所在的文件夹不可写，无法自动更新',
};

const ARROW = ['M12 8v8', 'm8 12 4 4 4-4'];
const FILL_TOP = 2;
const FILL_SPAN = 20;
const WATERLINE =
  'fill-(--mask-keep) transition-transform duration-(--dur-overlay) ease-(--ease-out-strong) motion-reduce:transition-none';

type UpdateMark = 'waiting' | 'failed' | null;

export interface DesktopUpdateView {
  label: string;
  busy: boolean;
  mark: UpdateMark;
}

export function desktopUpdateView(state: DesktopUpdateState, t: TFunc): DesktopUpdateView {
  const label =
    state.status === 'available'
      ? t('更新到 {version}', { version: state.version })
      : state.status === 'ready'
        ? t('离开时自动更新到 {version}', { version: state.version })
        : state.status === 'downloading'
          ? t('正在更新 {percent}%', { percent: Math.round(state.percent) })
          : state.status === 'installing'
            ? t('正在安装…')
            : state.status === 'restarting'
              ? t('正在重启…')
              : state.status === 'unsupported'
                ? t(BLOCKER_HINTS[state.blocker])
                : state.status === 'checking'
                  ? t('正在检查更新…')
                  : state.status === 'current'
                    ? t('已是最新版本 {version}', { version: state.version })
                    : state.status === 'offline'
                      ? t('无法连接网络，未能检查更新')
                      : state.status === 'error'
                        ? t('更新失败，点击重试')
                        : t('检查更新');
  const busy =
    state.status === 'checking' ||
    state.status === 'downloading' ||
    state.status === 'installing' ||
    state.status === 'restarting' ||
    state.status === 'unsupported';
  const mark: UpdateMark =
    state.status === 'available' ? 'waiting' : state.status === 'error' ? 'failed' : null;
  return { label, busy, mark };
}

function fillLevel(state: DesktopUpdateState): number {
  if (state.status === 'downloading') return Math.min(1, Math.max(0, state.percent / 100));
  return state.status === 'ready' || state.status === 'installing' || state.status === 'restarting'
    ? 1
    : 0;
}

function UpdateGlyph({
  level,
  mark,
  className,
}: {
  level: number;
  mark: UpdateMark;
  className: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const sink = (1 - level) * FILL_SPAN;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-level={Math.round(level * 100)}
      className={className}
    >
      <defs>
        <mask id={`${id}fill`}>
          <rect
            x="0"
            y={FILL_TOP}
            width="24"
            height="24"
            stroke="none"
            style={{ transform: `translateY(${sink}px)` }}
            className={WATERLINE}
          />
          {ARROW.map((d) => (
            <path key={d} d={d} className="stroke-(--mask-cut)" />
          ))}
        </mask>
        <mask id={`${id}dry`}>
          <rect
            x="0"
            y={FILL_TOP - 24}
            width="24"
            height="24"
            stroke="none"
            style={{ transform: `translateY(${sink}px)` }}
            className={WATERLINE}
          />
        </mask>
        {mark !== null && (
          <mask id={`${id}mark`}>
            <rect width="24" height="24" stroke="none" className="fill-(--mask-keep)" />
            <circle cx="19.6" cy="4.4" r="3.9" stroke="none" className="fill-(--mask-cut)" />
          </mask>
        )}
      </defs>
      <g mask={mark !== null ? `url(#${id}mark)` : undefined}>
        <circle cx="12" cy="12" r="10" />
        <g mask={`url(#${id}dry)`}>
          {ARROW.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" mask={`url(#${id}fill)`} />
      </g>
      {mark !== null && (
        <circle
          data-slot="update-mark"
          data-mark={mark}
          cx="19.6"
          cy="4.4"
          r="2.8"
          stroke="none"
          className={mark === 'waiting' ? 'fill-(--waiting-ink)' : 'fill-(--destructive)'}
        />
      )}
    </svg>
  );
}

export function DesktopUpdateButton({
  iconClassName,
  idleClassName,
}: {
  iconClassName: string;
  idleClassName: string;
}) {
  const { t } = useI18n();
  const [bridge] = useState(desktopUpdates);
  const subscribedState = useDesktopUpdateState();
  const [refusal, setRefusal] = useState<string | null>(null);
  const latestStatusRef = useRef(subscribedState.status);
  latestStatusRef.current = subscribedState.status;

  useEffect(() => {
    setRefusal(null);
  }, [subscribedState]);

  const state: DesktopUpdateState =
    refusal !== null &&
    subscribedState.status !== 'error' &&
    subscribedState.status !== 'offline' &&
    subscribedState.status !== 'unsupported'
      ? { status: 'error', message: refusal }
      : subscribedState;

  if (bridge === null) return null;

  const { label, busy, mark } = desktopUpdateView(state, t);
  const errorDetail = state.status === 'error' ? updateInstallRefusalCopy(state.message, t) : null;

  const showRefusal = (reason: string): void => {
    const current = latestStatusRef.current;
    if (current !== 'error' && current !== 'offline' && current !== 'unsupported') {
      setRefusal(reason);
    }
    toastError(updateInstallRefusalCopy(reason, t), null);
  };

  const handleClick = async (): Promise<void> => {
    if (state.status === 'unsupported') {
      toastError(label, null);
      return;
    }
    if (busy) return;
    if (state.status === 'available' || state.status === 'ready') {
      try {
        const result = await bridge.install();
        if (result !== undefined && !result.ok) {
          showRefusal(result.reason);
        }
      } catch (error) {
        showRefusal(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    try {
      await bridge.check();
    } catch (error) {
      showRefusal(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="desktop-update"
            data-status={state.status}
            aria-label={label}
            title={state.status === 'error' ? state.message : undefined}
            aria-disabled={busy || undefined}
            className={cn(idleClassName, busy && 'cursor-default')}
            onClick={() => void handleClick()}
          >
            <UpdateGlyph level={fillLevel(state)} mark={mark} className={iconClassName} />
          </Button>
        }
      />
      <TooltipContent side="top" sideOffset={6}>
        {errorDetail !== null && errorDetail !== label ? (
          <span className="flex flex-col gap-0.5">
            <span>{label}</span>
            <span className="text-caption opacity-80">{errorDetail}</span>
          </span>
        ) : (
          label
        )}
      </TooltipContent>
    </Tooltip>
  );
}
