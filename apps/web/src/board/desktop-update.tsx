import type { DesktopUpdateBlocker, DesktopUpdateState } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useId, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { desktopUpdates } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

export function canUpdateDesktop(): boolean {
  return desktopUpdates() !== null;
}

function installable(state: DesktopUpdateState | null): boolean {
  return state?.status === 'available' || state?.status === 'ready';
}

export async function updateDesktopNow(): Promise<void> {
  const bridge = desktopUpdates();
  if (bridge === null) return;
  if (!installable(await bridge.state())) await bridge.check();
  if (installable(await bridge.state())) await bridge.install();
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
                        ? t('更新失败：{message}', { message: state.message })
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
  const [state, setState] = useState<DesktopUpdateState>({ status: 'idle' });

  useEffect(() => {
    if (bridge === null) return;
    void bridge.state().then((initial) => {
      if (initial !== null) setState(initial);
    });
    return bridge.subscribe(setState);
  }, [bridge]);

  if (bridge === null) return null;

  const { label, busy, mark } = desktopUpdateView(state, t);

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
            aria-disabled={busy || undefined}
            className={cn(idleClassName, busy && 'cursor-default')}
            onClick={() => {
              if (busy) return;
              void (state.status === 'available' || state.status === 'ready'
                ? bridge.install()
                : bridge.check());
            }}
          >
            <UpdateGlyph level={fillLevel(state)} mark={mark} className={iconClassName} />
          </Button>
        }
      />
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
