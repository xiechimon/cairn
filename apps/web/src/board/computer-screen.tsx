import type { ComputerRecord } from '@cairn/shared';
import { Maximize2, MonitorSmartphone, Moon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { computerScreenWsUrl, openComputerScreen } from '../api/computer-screen.js';
import { Button } from '../components/ui/button.js';
import { Spinner } from '../components/ui/spinner.js';
import { useI18n } from '../i18n/provider.js';
import type { ScreenPointerProps } from './screen-hover-control.js';

type ScreenStatus = 'connecting' | 'connected' | 'placeholder' | 'failed';
type NovncRfb = import('@novnc/novnc').default;

const lastFrames = new Map<string, string>();

function rememberFrame(computerId: string, host: HTMLElement) {
  const canvas = host.querySelector('canvas');
  if (canvas === null || canvas.width === 0 || canvas.height === 0) return;
  try {
    lastFrames.set(computerId, canvas.toDataURL('image/jpeg', 0.8));
  } catch {
    lastFrames.delete(computerId);
  }
}

function resyncScale(rfb: NovncRfb) {
  rfb.scaleViewport = false;
  rfb.scaleViewport = true;
}

export function ScreenPlaceholder({ online, label }: { online: boolean; label: string }) {
  return (
    <div
      data-testid="machine-screen"
      className={`grid place-items-center bg-(--surface-1) px-6 text-center text-meta text-content-tertiary ${online ? 'aspect-[16/10] max-h-36' : 'h-16'}`}
    >
      <span className={`flex items-center gap-2 ${online ? 'flex-col' : ''}`}>
        <MonitorSmartphone aria-hidden="true" className="size-5.5 opacity-60" />
        {label}
      </span>
    </div>
  );
}

export function MachineScreenSurface({
  teamId,
  computer,
  leaseId,
  interactive,
  fill = false,
  onExpand,
  pointer,
  autoFocus = false,
  power = 'on',
  expandText,
}: {
  teamId: string;
  computer: ComputerRecord;
  leaseId: string | null;
  interactive: boolean;
  fill?: boolean;
  onExpand?: () => void;
  pointer?: ScreenPointerProps;
  autoFocus?: boolean;
  power?: 'on' | 'starting' | 'asleep';
  expandText?: string;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<NovncRfb | null>(null);
  const [status, setStatus] = useState<ScreenStatus>('connecting');
  const [lastFrame, setLastFrame] = useState(() => lastFrames.get(computer.id) ?? null);
  const online = computer.machine.online && computer.state !== 'failed';
  const controlLease = interactive ? leaseId : null;

  useEffect(() => {
    if (!online || host.current === null) {
      setStatus('placeholder');
      return;
    }
    const target = host.current;
    let cancelled = false;
    let rfb: NovncRfb | null = null;
    setStatus('connecting');
    const connect = async () => {
      try {
        const opened = await openComputerScreen(
          teamId,
          computer.id,
          controlLease !== null ? { kind: 'control', leaseId: controlLease } : { kind: 'view' },
        );
        if (cancelled) return;
        const { default: RFB } = await import('@novnc/novnc');
        if (cancelled) return;
        rfb = new RFB(target, computerScreenWsUrl(opened.path), {
          wsProtocols: opened.wsProtocols,
        });
        rfb.viewOnly = !interactive;
        rfb.clipViewport = false;
        rfb.scaleViewport = true;
        rfb.focusOnClick = interactive;
        rfb.showDotCursor = interactive;
        rfb.background = 'transparent';
        rfbRef.current = rfb;
        rfb.addEventListener('connect', () => {
          if (cancelled || rfb == null) return;
          setStatus('connected');
          resyncScale(rfb);
          requestAnimationFrame(() => {
            if (cancelled || rfbRef.current == null) return;
            resyncScale(rfbRef.current);
            if (interactive && autoFocus) rfbRef.current.focus({ preventScroll: true });
          });
        });
        rfb.addEventListener('disconnect', () => {
          if (cancelled) return;
          rememberFrame(computer.id, target);
          setLastFrame(lastFrames.get(computer.id) ?? null);
          setStatus('placeholder');
        });
        rfb.addEventListener('securityfailure', () => {
          if (!cancelled) setStatus('failed');
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
          setStatus('placeholder');
          return;
        }
        setStatus('failed');
      }
    };
    void connect();
    return () => {
      cancelled = true;
      rfbRef.current = null;
      rememberFrame(computer.id, target);
      setLastFrame(lastFrames.get(computer.id) ?? null);
      rfb?.disconnect();
      target.replaceChildren();
    };
  }, [teamId, computer.id, computer.machine.online, interactive, controlLease, online, autoFocus]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (rfb == null || status !== 'connected') return;
    rfb.viewOnly = !interactive;
    rfb.focusOnClick = interactive;
    rfb.showDotCursor = interactive;
    if (interactive && autoFocus) rfb.focus({ preventScroll: true });
  }, [interactive, autoFocus, status]);

  if (!online) return <ScreenPlaceholder online={false} label={t('电脑离线')} />;

  return (
    <div
      data-testid="machine-screen"
      data-status={status}
      data-interactive={interactive ? 'true' : 'false'}
      data-fill={fill ? 'true' : 'false'}
      {...pointer}
      className={`relative overflow-hidden ${fill ? 'h-full w-full' : 'aspect-[16/10] w-full border-t border-border bg-(--surface-1)'} ${interactive ? 'cursor-none touch-none' : 'cursor-default'}`}
    >
      {power === 'starting' && (
        <div
          data-testid="machine-screen-starting"
          className="absolute inset-0 z-1 grid place-items-center bg-(--surface-1)"
        >
          <Spinner aria-label={t('正在启动')} className="size-5 text-content-tertiary" />
        </div>
      )}
      {power === 'asleep' && (
        <div
          data-testid="machine-screen-asleep"
          className="absolute inset-0 z-1 grid place-items-center bg-(--surface-1)/70 text-content-secondary"
        >
          <Moon aria-hidden="true" className="size-5.5" />
        </div>
      )}
      {status !== 'connected' && lastFrame !== null && (
        <img
          alt=""
          aria-hidden="true"
          data-testid="machine-screen-last-frame"
          src={lastFrame}
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      <div ref={host} className="h-full w-full overflow-hidden [&_canvas]:outline-none" />
      {power === 'on' && status !== 'connected' && (lastFrame === null || status === 'failed') && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-meta text-content-tertiary">
          <span className="flex flex-col items-center gap-2">
            <MonitorSmartphone aria-hidden="true" className="size-5.5 opacity-60" />
            {status === 'connecting'
              ? t('正在连接屏幕')
              : status === 'failed'
                ? t('屏幕暂时连不上')
                : t('桌面控制已上线，屏幕显示在这里')}
          </span>
        </div>
      )}
      {onExpand != null && (
        <Button
          type="button"
          variant="ghost"
          data-testid="machine-screen-expand"
          aria-label={expandText ?? t('放大')}
          title={power === 'asleep' ? t('已休眠，用到时会自己启动') : undefined}
          className="group absolute inset-0 z-10 h-auto cursor-pointer rounded-none p-0 outline-none hover:text-inherit transition-colors duration-(--dur-overlay) hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
          onClick={onExpand}
        >
          <span
            className={`absolute top-2 right-2 grid h-7 place-items-center rounded-(--radius-control) bg-popover text-foreground shadow-(--e2) transition-opacity duration-(--dur-overlay) group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none ${expandText === undefined ? 'w-7 opacity-0' : 'px-2.5 text-meta opacity-100'}`}
          >
            {expandText ?? <Maximize2 aria-hidden="true" className="size-4" />}
          </span>
        </Button>
      )}
    </div>
  );
}
