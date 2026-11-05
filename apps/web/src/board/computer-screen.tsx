import type { ComputerRecord } from '@cairn/shared';
import { Maximize2, MonitorSmartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { computerScreenWsUrl, openComputerScreen } from '../api/computer-screen.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';

type ScreenStatus = 'connecting' | 'connected' | 'placeholder' | 'failed';
type NovncRfb = import('@novnc/novnc').default;

export function ScreenPlaceholder({ online, label }: { online: boolean; label: string }) {
  return (
    <div
      data-testid="machine-screen"
      className={`grid place-items-center bg-(--surface-1) px-6 text-center text-meta text-content-tertiary ${online ? 'aspect-[16/10]' : 'h-16'}`}
    >
      <span className={`flex items-center gap-2 ${online ? 'flex-col' : ''}`}>
        <MonitorSmartphone aria-hidden="true" className="size-5 opacity-60" />
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
}: {
  teamId: string;
  computer: ComputerRecord;
  leaseId: string | null;
  interactive: boolean;
  fill?: boolean;
  onExpand?: () => void;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ScreenStatus>('connecting');
  const online = computer.machine.online && computer.state !== 'failed';

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
          interactive && leaseId !== null ? { kind: 'control', leaseId } : { kind: 'view' },
        );
        if (cancelled) return;
        const { default: RFB } = await import('@novnc/novnc');
        if (cancelled) return;
        rfb = new RFB(target, computerScreenWsUrl(opened.path), {
          wsProtocols: opened.wsProtocols,
        });
        rfb.viewOnly = !interactive;
        rfb.scaleViewport = true;
        rfb.clipViewport = true;
        rfb.focusOnClick = interactive;
        rfb.background = 'transparent';
        rfb.addEventListener('connect', () => {
          if (!cancelled) setStatus('connected');
        });
        rfb.addEventListener('disconnect', () => {
          if (!cancelled) setStatus('placeholder');
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
      rfb?.disconnect();
      target.replaceChildren();
    };
  }, [teamId, computer.id, computer.machine.online, computer.state, interactive, leaseId, online]);

  if (!online) return <ScreenPlaceholder online={false} label={t('电脑离线')} />;

  return (
    <div
      data-testid="machine-screen"
      data-status={status}
      data-interactive={interactive ? 'true' : 'false'}
      className={`relative overflow-hidden bg-(--surface-1) ${fill ? 'min-h-0 flex-1' : 'aspect-[16/10]'}`}
    >
      <div ref={host} className="absolute inset-0" />
      {status !== 'connected' && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-meta text-content-tertiary">
          <span className="flex flex-col items-center gap-2">
            <MonitorSmartphone aria-hidden="true" className="size-5 opacity-60" />
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
          variant="secondary"
          size="icon-sm"
          data-testid="machine-screen-expand"
          aria-label={t('放大屏幕')}
          className="absolute top-2 right-2 z-10"
          onClick={onExpand}
        >
          <Maximize2 aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
