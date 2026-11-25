import { cn } from 'cn';
import { X } from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useI18n } from '../i18n/provider.js';
import { safeLocalStorage, safeSetItem } from '../safe-storage.js';
import { IconTooltip } from './icon-tooltip.js';
import {
  clampPanelWidth,
  dockedThreadLayout,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MIN,
  PANEL_WIDTH_STEP,
  PANEL_WIDTH_STORAGE_KEY,
  panelWidthMax,
  readPanelWidth,
} from './side-panel-width.js';
import { Button } from './ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';

const listeners = new Set<() => void>();
let widthNow: number | null = null;

interface Drag {
  pointerId: number;
  x: number;
  width: number;
  moved: boolean;
  to: number;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function currentWidth(): number {
  widthNow ??= readPanelWidth(safeLocalStorage()?.getItem(PANEL_WIDTH_STORAGE_KEY) ?? null);
  return clampPanelWidth(widthNow, viewportWidth());
}

function notify(): void {
  for (const listener of listeners) listener();
}

function commitWidth(next: number): void {
  widthNow = next;
  safeSetItem(PANEL_WIDTH_STORAGE_KEY, String(widthNow));
  notify();
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

function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, viewportWidth, () => 1440);
}

function ResizeHandle({
  width,
  panelRef,
}: {
  width: number;
  panelRef: { current: HTMLElement | null };
}) {
  const { t } = useI18n();
  const drag = useRef<Drag | null>(null);
  const handleRef = useRef<HTMLHRElement | null>(null);
  const [tip, setTip] = useState(false);
  const setLiveWidth = (next: number | null) => {
    const panel = panelRef.current;
    if (panel == null) return;
    if (next === null) delete panel.dataset.resizing;
    else panel.dataset.resizing = '';
    const shown = next === null ? width : clampPanelWidth(next, viewportWidth());
    panel.style.setProperty('--side-panel-w', `${shown}px`);
    handleRef.current?.setAttribute('aria-valuenow', String(shown));
  };
  const setDragCursor = (active: boolean) => {
    document.documentElement.classList.toggle('select-none', active);
    document.documentElement.classList.toggle('cursor-col-resize', active);
  };
  useEffect(() => {
    const onWindowResize = () => {
      if (drag.current === null) return;
      const panel = panelRef.current;
      if (panel == null) return;
      const shown = clampPanelWidth(drag.current.to, viewportWidth());
      panel.style.setProperty('--side-panel-w', `${shown}px`);
      handleRef.current?.setAttribute('aria-valuenow', String(shown));
    };
    window.addEventListener('resize', onWindowResize);
    return () => {
      window.removeEventListener('resize', onWindowResize);
      if (drag.current !== null) {
        drag.current = null;
        setDragCursor(false);
      }
    };
  }, [panelRef]);
  const onPointerDown = (event: PointerEvent<HTMLHRElement>) => {
    if (event.button !== 0 || drag.current !== null) return;
    setTip(false);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragCursor(true);
    setLiveWidth(width);
    drag.current = { pointerId: event.pointerId, x: event.clientX, width, moved: false, to: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (!drag.current.moved && event.clientX === drag.current.x) return;
    drag.current.moved = true;
    drag.current.to = clampPanelWidth(
      drag.current.width + drag.current.x - event.clientX,
      viewportWidth(),
    );
    setLiveWidth(drag.current.to);
  };
  const onPointerUp = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const ended = drag.current;
    drag.current = null;
    setDragCursor(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (ended.moved) {
      setLiveWidth(ended.to);
      delete panelRef.current?.dataset.resizing;
      commitWidth(ended.to);
    } else {
      setLiveWidth(null);
    }
  };
  const onPointerCancel = (event: PointerEvent<HTMLHRElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragCursor(false);
    setLiveWidth(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const commitEndingDrag = (handle: HTMLHRElement, next: number) => {
    const active = drag.current;
    drag.current = null;
    setDragCursor(false);
    if (active !== null && handle.hasPointerCapture(active.pointerId))
      handle.releasePointerCapture(active.pointerId);
    setLiveWidth(next);
    delete panelRef.current?.dataset.resizing;
    commitWidth(next);
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
    commitEndingDrag(event.currentTarget, clampPanelWidth(next, viewportWidth()));
  };
  return (
    <Tooltip open={tip} onOpenChange={(next) => setTip(next && drag.current === null)}>
      <TooltipTrigger
        render={
          <span
            data-slot="side-panel-resize-zone"
            className="absolute inset-y-0 -left-5 z-1 w-6 max-[1100px]:hidden"
          />
        }
      >
        <hr
          ref={handleRef}
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
          onPointerCancel={onPointerCancel}
          onDoubleClick={(event) => commitEndingDrag(event.currentTarget, PANEL_WIDTH_DEFAULT)}
          onKeyDown={onKeyDown}
          className="absolute inset-0 m-0 h-auto w-full border-0 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-[19px] after:w-0.5 after:bg-transparent after:transition-colors after:duration-(--dur-fast) after:ease-(--ease-standard) hover:after:bg-(--border) focus-visible:after:bg-(--focus-ring) active:after:bg-(--focus-ring)"
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

const RESIZABLE_PANEL = ':scope > aside.side-panel:not([data-docked])';

function useDockRow(node: HTMLElement | null): { row: number; panel: number | null } | null {
  const [size, setSize] = useState<{ row: number; panel: number | null } | null>(null);
  useLayoutEffect(() => {
    const parent = node?.parentElement;
    if (parent == null) return;
    let watched: Element | null = null;
    const resized = new ResizeObserver(() => measure());
    const measure = () => {
      const panel = parent.querySelector<HTMLElement>(RESIZABLE_PANEL);
      if (panel !== watched) {
        if (watched !== null) resized.unobserve(watched);
        if (panel !== null) resized.observe(panel);
        watched = panel;
      }
      const next = { row: parent.clientWidth, panel: panel?.offsetWidth ?? null };
      setSize((last) => (last?.row === next.row && last.panel === next.panel ? last : next));
    };
    resized.observe(parent);
    const added = new MutationObserver(measure);
    added.observe(parent, { childList: true });
    measure();
    return () => {
      resized.disconnect();
      added.disconnect();
    };
  }, [node]);
  return size;
}

export function SidePanel({
  ref,
  label,
  onDismiss,
  scrimTestId,
  phoneTab = false,
  docked = false,
  testId,
  children,
}: {
  ref?: Ref<HTMLElement>;
  label: string;
  onDismiss: () => void;
  scrimTestId?: string;
  phoneTab?: boolean;
  docked?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  const committedWidth = useSidePanelWidth();
  const viewport = useViewportWidth();
  const width = clampPanelWidth(committedWidth, viewport);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const dockRow = useDockRow(docked ? node : null);
  const besideWidth = dockRow?.panel ?? width;
  const layout = dockRow === null ? null : dockedThreadLayout(dockRow.row, besideWidth);
  const setRef = (element: HTMLElement | null) => {
    asideRef.current = element;
    setNode(element);
    if (typeof ref === 'function') ref(element);
    else if (ref != null) ref.current = element;
  };
  if (docked) {
    return (
      <aside
        ref={setRef}
        aria-label={label}
        data-testid={testId}
        data-docked={layout?.floating === true ? 'floating' : ''}
        style={
          {
            '--side-panel-w': `${layout?.width ?? width}px`,
            '--side-panel-right': `${besideWidth}px`,
          } as CSSProperties
        }
        className={cn(
          'side-panel relative flex w-(--side-panel-w) min-w-0 flex-none flex-col border-l border-border bg-background',
          layout?.floating === true &&
            'absolute inset-y-0 right-(--side-panel-right) z-(--z-panel-low) shadow-(--floating-shadow)',
        )}
      >
        {children}
      </aside>
    );
  }
  return (
    <>
      <div
        data-testid={scrimTestId}
        aria-hidden
        className="side-panel-scrim absolute inset-0 z-(--z-backdrop-low) hidden bg-(--dialog-backdrop) max-[1100px]:block"
        onClick={onDismiss}
      />
      <aside
        ref={setRef}
        aria-label={label}
        data-testid={testId}
        data-phone-tab={phoneTab || undefined}
        style={{ '--side-panel-w': `${width}px` } as CSSProperties}
        className="side-panel relative flex w-(--side-panel-w) min-w-0 flex-none flex-col border-l border-border bg-background max-[1100px]:absolute max-[1100px]:inset-y-0 max-[1100px]:right-0 max-[1100px]:z-(--z-panel-low) max-[1100px]:w-[min(420px,100%)] max-[1100px]:border-l-0 max-[1100px]:shadow-(--floating-shadow) max-[640px]:w-full"
      >
        <ResizeHandle width={width} panelRef={asideRef} />
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
      <IconTooltip
        label={closeLabel}
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-panel-close=""
            className={cn(
              'text-content-secondary hover:text-foreground pointer-coarse:size-11',
              closeClassName,
            )}
            onClick={onClose}
          />
        }
      >
        <X aria-hidden strokeWidth={1.75} className="size-5.5" />
      </IconTooltip>
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
