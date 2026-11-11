import { cn } from 'cn';
import { X } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import {
  clampPanelWidth,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_STEP,
  PANEL_WIDTH_STORAGE_KEY,
  panelWidthMax,
  readPanelWidth,
} from './side-panel-width.js';
import { Button } from './ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';

const RESIZE_TIP_DELAY = 600;

const listeners = new Set<() => void>();
let widthNow: number | null = null;

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function currentWidth(): number {
  widthNow ??= readPanelWidth(
    safeLocalStorage()?.getItem(PANEL_WIDTH_STORAGE_KEY) ?? null,
    viewportWidth(),
  );
  return clampPanelWidth(widthNow, viewportWidth());
}

function setWidth(next: number, persist: boolean): void {
  widthNow = clampPanelWidth(next, viewportWidth());
  if (persist) safeSetItem(PANEL_WIDTH_STORAGE_KEY, String(widthNow));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('resize', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('resize', listener);
  };
}

function useSidePanelWidth(): number {
  return useSyncExternalStore(subscribe, currentWidth, () => PANEL_WIDTH_DEFAULT);
}

function ResizeHandle({ width }: { width: number }) {
  const { t } = useI18n();
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [tip, setTip] = useState(false);
  const onPointerDown = (event: PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0) return;
    setTip(false);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current === null) return;
    setWidth(drag.current.width + drag.current.x - event.clientX, false);
  };
  const onPointerUp = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current === null) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setWidth(currentWidth(), true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    const next =
      event.key === 'ArrowLeft'
        ? width + PANEL_WIDTH_STEP
        : event.key === 'ArrowRight'
          ? width - PANEL_WIDTH_STEP
          : event.key === 'Home'
            ? PANEL_WIDTH_MIN
            : event.key === 'End'
              ? panelWidthMax(viewportWidth())
              : null;
    if (next === null) return;
    event.preventDefault();
    setWidth(next, true);
  };
  return (
    <Tooltip open={tip} onOpenChange={(next) => setTip(next && drag.current === null)}>
      <TooltipTrigger
        delay={RESIZE_TIP_DELAY}
        render={
          <span
            data-slot="side-panel-resize-zone"
            className="absolute inset-y-0 -left-1 z-1 w-2 max-[1100px]:hidden"
          />
        }
      >
        <hr
          aria-orientation="vertical"
          aria-label={t('调整面板宽度')}
          aria-valuenow={width}
          aria-valuemin={PANEL_WIDTH_MIN}
          aria-valuemax={panelWidthMax(viewportWidth())}
          tabIndex={0}
          data-testid="side-panel-resize"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => setWidth(PANEL_WIDTH_DEFAULT, true)}
          onKeyDown={onKeyDown}
          className="absolute inset-0 m-0 h-auto w-2 border-0 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:bg-transparent after:transition-colors hover:after:bg-(--border) focus-visible:after:bg-(--focus-ring) active:after:bg-(--focus-ring)"
        />
      </TooltipTrigger>
      <TooltipContent
        side="left"
        sideOffset={8}
        data-slot="side-panel-resize-tip"
        className="pointer-events-none"
      >
        {t('拖动调宽')}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidePanel({
  ref,
  label,
  onDismiss,
  scrimTestId,
  phoneTab = false,
  testId,
  children,
}: {
  ref?: Ref<HTMLElement>;
  label: string;
  onDismiss: () => void;
  scrimTestId?: string;
  phoneTab?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const width = useSidePanelWidth();
  return (
    <>
      <div
        data-testid={scrimTestId}
        aria-hidden
        className="side-panel-scrim absolute inset-0 z-(--z-backdrop-low) hidden bg-(--dialog-backdrop) max-[1100px]:block"
        onClick={onDismiss}
      />
      <aside
        ref={ref}
        aria-label={label}
        data-testid={testId}
        data-phone-tab={phoneTab || undefined}
        style={{ '--side-panel-w': `${width}px` } as CSSProperties}
        className="side-panel relative flex w-(--side-panel-w) min-w-0 flex-none flex-col border-l border-border bg-background max-[1100px]:absolute max-[1100px]:inset-y-0 max-[1100px]:right-0 max-[1100px]:z-(--z-panel-low) max-[1100px]:w-[min(420px,100%)] max-[1100px]:border-l-0 max-[1100px]:shadow-(--floating-shadow) max-[640px]:w-full"
      >
        <ResizeHandle width={width} />
        {children}
      </aside>
    </>
  );
}

export function SidePanelHead({
  closeLabel,
  onClose,
  className,
  closeClassName,
  children,
}: {
  closeLabel: string;
  onClose: () => void;
  className?: string;
  closeClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-panel-head=""
      className={cn('flex h-12 flex-none items-center gap-2 px-4', className)}
    >
      {children}
      <Button
        variant="ghost"
        size="icon-sm"
        data-panel-close=""
        className={cn('text-content-secondary hover:text-foreground', closeClassName)}
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X aria-hidden strokeWidth={1.75} className="size-5.5" />
      </Button>
    </div>
  );
}

export function SidePanelTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2
      className={cn(
        'm-0 flex min-w-0 flex-1 items-center gap-1.5 truncate text-heading font-normal text-foreground',
        className,
      )}
    >
      {children}
    </h2>
  );
}
