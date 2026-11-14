import type { ComputerRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Minimize2 } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { useComputerControl } from '../api/use-computer-control.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { MachineScreenSurface } from './computer-screen.js';

export type ComputerControl = ReturnType<typeof useComputerControl>;

export function ComputerControlBar({
  held,
  busy,
  handoff,
  compact = false,
  onTakeOver,
  onGiveBack,
}: {
  compact?: boolean;
  handoff: ComputerRecord['handoffReason'];
  held: boolean;
  busy: boolean;
  onTakeOver: () => void;
  onGiveBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="computer-control-bar"
      data-held={held ? 'true' : 'false'}
      data-handoff={handoff ?? 'none'}
      className={cn(
        'flex items-center gap-3',
        compact ? 'flex-none' : 'justify-between px-2.5 py-2',
      )}
    >
      {!compact && (
        <span
          className={cn(
            'text-meta',
            !held && handoff !== null ? 'text-foreground' : 'text-content-tertiary',
          )}
        >
          {held
            ? t('你在操作，Coordinator 已暂停')
            : handoff !== null
              ? t('需要你登录')
              : t('只看，不能点')}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="pointer-coarse:h-11 pointer-coarse:px-4"
        disabled={busy}
        onClick={held ? onGiveBack : onTakeOver}
      >
        {held ? t('交还') : t('接管')}
      </Button>
    </div>
  );
}

const CHROME_IDLE_MS = 2_500;

function useBrowserFullscreen(open: boolean, onExit: () => void) {
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  useEffect(() => {
    if (!open || document.fullscreenElement != null || !document.fullscreenEnabled) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement != null) {
        entered = true;
        return;
      }
      if (entered) exitRef.current();
    };
    document.addEventListener('fullscreenchange', onChange);
    void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (entered && document.fullscreenElement != null)
        void document.exitFullscreen().catch(() => {});
    };
  }, [open]);
}

function useIdleChrome(): [boolean, () => void] {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), CHROME_IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(timer.current);
  }, [wake]);
  return [idle, wake];
}

export function ComputerScreenDialog({
  open,
  onClose,
  title,
  teamId,
  computer,
  control,
  status,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  teamId: string;
  computer: ComputerRecord;
  control: ComputerControl;
  status?: ReactNode;
}) {
  const { t } = useI18n();
  const { leaseId } = control;
  const [idle, wake] = useIdleChrome();
  useBrowserFullscreen(open, onClose);
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      viewportRoot
      backdropClassName="bg-(--screen-letterbox)"
      zIndex="var(--z-modal)"
    >
      <div
        role="dialog"
        aria-label={title}
        data-testid="machine-screen-enlarged"
        className="fixed inset-0 z-(--z-modal) bg-(--screen-letterbox) pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        onPointerMoveCapture={wake}
        onPointerDownCapture={wake}
        onKeyDownCapture={wake}
      >
        <MachineScreenSurface
          teamId={teamId}
          computer={computer}
          leaseId={leaseId}
          interactive={leaseId !== null}
          fill
          autoFocus
        />
        <div
          data-testid="machine-screen-chrome"
          data-idle={idle ? 'true' : 'false'}
          className="absolute top-[calc(env(safe-area-inset-top)+0.75rem)] left-1/2 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-(--radius-popover) bg-popover py-1.5 pr-1.5 pl-4 text-popover-foreground shadow-(--e2) transition-opacity duration-(--dur-overlay) focus-within:opacity-100 hover:opacity-100 pointer-fine:data-[idle=true]:opacity-0 motion-reduce:transition-none"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-ui text-foreground">{title}</span>
            <span className="hidden truncate text-meta text-content-tertiary sm:block">
              {status ??
                (leaseId !== null ? t('你在操作，Coordinator 已暂停') : t('接管后才能点击和键入'))}
            </span>
          </div>
          <ComputerControlBar
            compact
            held={control.controlHeld}
            busy={control.busy}
            handoff={computer.handoffReason}
            onTakeOver={() => control.setHeld(true)}
            onGiveBack={() => control.setHeld(false)}
          />
          <IconTooltip
            label={t('退出全屏')}
            side="bottom"
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid="machine-screen-exit"
                className="flex-none text-content-tertiary hover:text-foreground pointer-coarse:size-11"
                aria-label={t('退出全屏')}
                onClick={onClose}
              />
            }
          >
            <Minimize2 aria-hidden="true" className="size-5" />
          </IconTooltip>
        </div>
      </div>
    </DialogShell>
  );
}
