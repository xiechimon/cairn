import type { ComputerRecord } from '@cairn/shared';
import { MonitorSmartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { computerScreenWsUrl, openComputerScreen } from '../api/computer-screen.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

type ScreenStatus = 'connecting' | 'connected' | 'disconnected' | 'placeholder' | 'failed';
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

export function MachineScreenSurface({
  teamId,
  computer,
  leaseId,
  interactive,
}: {
  teamId: string;
  computer: ComputerRecord;
  leaseId: string | null;
  interactive: boolean;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<NovncRfb | null>(null);
  const [status, setStatus] = useState<ScreenStatus>('connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
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
            if (interactive) rfbRef.current.focus({ preventScroll: true });
          });
        });
        rfb.addEventListener('disconnect', () => {
          if (cancelled) return;
          rememberFrame(computer.id, target);
          setLastFrame(lastFrames.get(computer.id) ?? null);
          setStatus('disconnected');
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
  }, [
    teamId,
    computer.id,
    computer.machine.online,
    interactive,
    controlLease,
    online,
    reconnectAttempt,
  ]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (rfb == null || status !== 'connected') return;
    rfb.viewOnly = !interactive;
    rfb.focusOnClick = interactive;
    rfb.showDotCursor = interactive;
    if (interactive) rfb.focus({ preventScroll: true });
  }, [interactive, status]);

  if (!online)
    return (
      <div
        data-testid="machine-screen"
        data-status="offline"
        className="grid h-full w-full place-items-center px-6 text-center text-meta text-content-tertiary"
      >
        {t('电脑离线')}
      </div>
    );

  const showReconnectOverlay = status === 'disconnected' || status === 'failed';
  return (
    <div
      data-testid="machine-screen"
      data-status={status}
      data-interactive={interactive ? 'true' : 'false'}
      className={`relative h-full w-full overflow-hidden ${interactive && status === 'connected' ? 'cursor-none touch-none' : 'cursor-default'}`}
    >
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
      {status !== 'connected' && (lastFrame === null || showReconnectOverlay) && (
        <div
          data-testid={status === 'disconnected' ? 'machine-screen-disconnected' : undefined}
          className={`absolute inset-0 grid place-items-center px-6 text-center text-meta ${
            showReconnectOverlay && lastFrame !== null
              ? 'bg-background/80 text-foreground'
              : 'text-content-tertiary'
          }`}
        >
          <span className="flex flex-col items-center gap-2">
            <MonitorSmartphone aria-hidden="true" className="size-5.5 opacity-60" />
            <span>
              {status === 'connecting'
                ? t('正在连接屏幕')
                : status === 'disconnected'
                  ? t('屏幕连接已断开')
                  : status === 'failed'
                    ? t('暂时无法连接屏幕')
                    : t('这台电脑现在没有画面')}
            </span>
            {showReconnectOverlay && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="machine-screen-reconnect"
                className="mt-1 pointer-coarse:h-11 pointer-coarse:px-4"
                onClick={() => setReconnectAttempt((count) => count + 1)}
              >
                {t('重连')}
              </Button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
