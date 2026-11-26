import { Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { IconTooltip } from '../../../components/icon-tooltip.js';
import { Button } from '../../../components/ui/button.js';
import { useI18n } from '../../../i18n/provider.js';
import { isEditableTarget } from '../../../overlay/hotkeys.js';
import { TOOL_BUTTON } from '../artifact-toolbar.js';

export type Zoom = 'fit' | number;

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const BLOCKING_LAYER = [
  '.overlay',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[data-slot="popover-content"][data-open]',
  '[data-testid="sidebar-peek"][data-open]',
].join(', ');

export function hasBlockingLayer(): boolean {
  return [...document.querySelectorAll(BLOCKING_LAYER)].some((el) => el.checkVisibility());
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((step) => step > current + 0.001) ?? MAX_ZOOM;
  return [...STEPS].reverse().find((step) => step < current - 0.001) ?? MIN_ZOOM;
}

export function nextPinchZoom(current: number, deltaY: number, deltaMode: number): number {
  const scaled = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  const clamped = Math.max(-100, Math.min(100, scaled));
  return clampZoom(current * Math.exp(-clamped * 0.01));
}

export interface ZoomAnchor {
  relX: number;
  relY: number;
  pointerX: number;
  pointerY: number;
}

export function zoomAnchorRatio({
  clientX,
  clientY,
  stageRect,
  contentRect,
}: {
  clientX: number;
  clientY: number;
  stageRect: { left: number; top: number };
  contentRect: { left: number; top: number; width: number; height: number };
}): ZoomAnchor {
  return {
    relX: (clientX - contentRect.left) / Math.max(1, contentRect.width),
    relY: (clientY - contentRect.top) / Math.max(1, contentRect.height),
    pointerX: clientX - stageRect.left,
    pointerY: clientY - stageRect.top,
  };
}

export function zoomAnchorScroll({
  anchor,
  stageRect,
  contentRect,
  scrollLeft,
  scrollTop,
}: {
  anchor: ZoomAnchor;
  stageRect: { left: number; top: number };
  contentRect: { left: number; top: number; width: number; height: number };
  scrollLeft: number;
  scrollTop: number;
}): { left: number; top: number } {
  const contentLeftInScroll = contentRect.left - stageRect.left + scrollLeft;
  const contentTopInScroll = contentRect.top - stageRect.top + scrollTop;
  return {
    left: Math.max(0, contentLeftInScroll + anchor.relX * contentRect.width - anchor.pointerX),
    top: Math.max(0, contentTopInScroll + anchor.relY * contentRect.height - anchor.pointerY),
  };
}

export function zoomShortcutAction(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): 'in' | 'out' | 'fit' | null {
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return null;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
  if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') return 'out';
  if (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0') return 'fit';
  return null;
}

export function usePinchZoom({
  stage,
  content,
  scale,
  onChange,
}: {
  stage: HTMLElement | null;
  content: HTMLElement | null;
  scale: number;
  onChange: (next: Zoom) => void;
}) {
  const anchorRef = useRef<ZoomAnchor | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const applyWheel = useCallback(
    (deltaY: number, deltaMode: number, clientX: number, clientY: number) => {
      if (stage === null) return;
      const current = scaleRef.current;
      const next = nextPinchZoom(current, deltaY, deltaMode);
      if (Math.abs(next - current) < 1e-6) return;
      if (content !== null) {
        anchorRef.current = zoomAnchorRatio({
          clientX,
          clientY,
          stageRect: stage.getBoundingClientRect(),
          contentRect: content.getBoundingClientRect(),
        });
      }
      onChangeRef.current(next);
    },
    [stage, content],
  );

  useEffect(() => {
    if (stage === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      applyWheel(event.deltaY, event.deltaMode, event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [stage, applyWheel]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null || stage === null || content === null) return;
    anchorRef.current = null;
    const next = zoomAnchorScroll({
      anchor,
      stageRect: stage.getBoundingClientRect(),
      contentRect: content.getBoundingClientRect(),
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
    });
    stage.scrollLeft = next.left;
    stage.scrollTop = next.top;
  }, [scale, stage, content]);

  return applyWheel;
}

export function useZoomShortcuts({
  active,
  scale,
  onChange,
}: {
  active: boolean;
  scale: number;
  onChange: (next: Zoom) => void;
}) {
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (isEditableTarget(event.target) || hasBlockingLayer()) return;
      const action = zoomShortcutAction(event);
      if (action === null) return;
      event.preventDefault();
      if (action === 'fit') onChangeRef.current('fit');
      else onChangeRef.current(stepZoom(scaleRef.current, action === 'in' ? 1 : -1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

export function ZoomControl({
  zoom,
  fitScale,
  onChange,
}: {
  zoom: Zoom;
  fitScale: number;
  onChange: (next: Zoom) => void;
}) {
  const { t } = useI18n();
  const scale = zoom === 'fit' ? fitScale : zoom;
  return (
    <div data-testid="artifact-zoom" className="flex items-center gap-0.5 max-[640px]:hidden">
      <IconTooltip
        label={t('缩小')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="artifact-zoom-out"
            aria-keyshortcuts="Meta+Minus Control+Minus"
            onClick={() => onChange(stepZoom(scale, -1))}
            className={`${TOOL_BUTTON} w-7 px-0`}
          />
        }
      >
        <Minus aria-hidden className="size-4" />
      </IconTooltip>
      <Button
        variant="ghost"
        size="sm"
        data-testid="artifact-zoom-fit"
        aria-keyshortcuts="Meta+0 Control+0"
        aria-pressed={zoom === 'fit'}
        onClick={() => onChange(zoom === 'fit' ? 1 : 'fit')}
        className={`${TOOL_BUTTON} min-w-14 justify-center tabular-nums`}
      >
        {zoom === 'fit' ? t('适应') : `${Math.round(scale * 100)}%`}
      </Button>
      <IconTooltip
        label={t('放大')}
        side="bottom"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="artifact-zoom-in"
            aria-keyshortcuts="Meta+Equal Control+Equal"
            onClick={() => onChange(stepZoom(scale, 1))}
            className={`${TOOL_BUTTON} w-7 px-0`}
          />
        }
      >
        <Plus aria-hidden className="size-4" />
      </IconTooltip>
    </div>
  );
}
