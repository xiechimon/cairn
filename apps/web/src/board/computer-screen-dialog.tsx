import type { ComputerRecord } from '@cairn/shared';
import { cn } from 'cn';
import { Minimize2 } from 'lucide-react';
import {
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { MachineName } from '../components/machine-label.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { setDesktopWindowControlsVisible } from '../desktop-shell.js';
import { useI18n } from '../i18n/provider.js';
import { MachineScreenSurface } from './computer-screen.js';
import { joinMeta } from './rel-time.js';
import {
  type ComputerControl,
  type ScreenHover,
  screenControlStatus,
} from './screen-hover-control.js';

const BAR_ZONE_PX = 56;
const BAR_HIDE_MS = 1_000;
const COARSE_QUERY = '(pointer: coarse)';

function useRevealBar() {
  const bar = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [near, setNear] = useState(false);
  const [focused, setFocused] = useState(false);
  const coarse = window.matchMedia(COARSE_QUERY).matches;

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const inBar = (target: EventTarget | null) =>
    target instanceof Node && bar.current?.contains(target) === true;

  const show = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
    setNear(true);
  };
  const hideSoon = () => {
    if (hideTimer.current !== undefined) return;
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = undefined;
      setNear(false);
    }, BAR_HIDE_MS);
  };

  return {
    bar,
    shown: near || focused || coarse,
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      if (inBar(event.target) || event.clientY <= BAR_ZONE_PX) show();
      else hideSoon();
    },
    onPointerLeave: hideSoon,
    onFocus: (event: FocusEvent<HTMLElement>) =>
      setFocused(inBar(event.target) && event.target.matches(':focus-visible')),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!inBar(event.relatedTarget)) setFocused(false);
    },
  };
}

export function ComputerScreenDialog({
  onClose,
  title,
  teamId,
  computer,
  control,
  hover,
  note,
}: {
  onClose: () => void;
  title: string;
  teamId: string;
  computer: ComputerRecord;
  control: ComputerControl;
  hover: ScreenHover;
  note?: string;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const reveal = useRevealBar();
  const { leaseId } = control;

  useEffect(() => {
    setDesktopWindowControlsVisible(reveal.shown);
  }, [reveal.shown]);

  useEffect(
    () => () => {
      setDesktopWindowControlsVisible(true);
      hover.leave();
    },
    [hover],
  );

  return (
    <DialogShell
      onClose={onClose}
      viewportRoot
      initialFocus={root}
      backdropClassName="bg-(--screen-letterbox)"
      zIndex="var(--z-modal)"
    >
      <div
        ref={root}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        data-testid="machine-screen-enlarged"
        className="fixed inset-0 z-(--z-modal) bg-(--screen-letterbox) pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none"
        onPointerMove={reveal.onPointerMove}
        onPointerLeave={reveal.onPointerLeave}
        onFocus={reveal.onFocus}
        onBlur={reveal.onBlur}
      >
        <MachineScreenSurface
          teamId={teamId}
          computer={computer}
          leaseId={leaseId}
          interactive={leaseId !== null}
          fill
          autoFocus
          pointer={hover.pointer}
        />
        <div
          ref={reveal.bar}
          data-testid="machine-screen-bar"
          data-shown={reveal.shown ? 'true' : 'false'}
          className={cn(
            'absolute top-[calc(env(safe-area-inset-top)+0.5rem)] left-1/2 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-(--radius-popover) bg-popover py-1 pr-1 pl-4 text-popover-foreground shadow-(--e2) transition-opacity duration-(--dur-overlay) motion-reduce:transition-none',
            reveal.shown ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-ui text-foreground">
              <MachineName machine={{ id: computer.machine.id, name: title }} compact />
            </span>
            <span
              data-testid="machine-screen-status"
              className="truncate text-meta text-content-tertiary"
            >
              {joinMeta([screenControlStatus(control, t), note])}
            </span>
          </div>
          <IconTooltip
            label={t('缩小')}
            side="bottom"
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                data-testid="machine-screen-exit"
                className="flex-none text-content-tertiary hover:text-foreground pointer-coarse:size-11"
                aria-label={t('缩小')}
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
