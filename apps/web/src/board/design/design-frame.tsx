import type { DesignViewport } from '@cairn/shared';
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { usePinchZoom, type Zoom } from '../artifact/viewers/zoom.js';
import type { PreviewWheelPayload } from './design-bridge.js';

export const VIEWPORT_SIZE: Record<DesignViewport, { width: number; height: number } | null> = {
  desktop: null,
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};

const CANVAS_PAD = 24;

export const FRAME_SANDBOX = 'allow-scripts allow-forms allow-downloads';

export interface FrameTransform {
  scale: number;
  width: number;
  height: number;
}

function useSize(node: HTMLElement | null): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (node === null) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return size;
}

export function frameTransform(
  viewport: DesignViewport,
  canvas: { width: number; height: number } | null,
): FrameTransform | null {
  if (canvas === null) return null;
  const preset = VIEWPORT_SIZE[viewport];
  if (preset === null) return { scale: 1, width: canvas.width, height: canvas.height };
  const scale = Math.min(
    1,
    Math.max(1, canvas.width - CANVAS_PAD * 2) / preset.width,
    Math.max(1, canvas.height - CANVAS_PAD * 2) / preset.height,
  );
  return { scale, width: preset.width, height: preset.height };
}

const noop = () => {};

export function DesignFrame({
  frameRef,
  srcdoc,
  title,
  viewport,
  zoom = 'fit',
  onFitScale,
  onZoomChange,
  wheelBridgeRef,
  overlay,
}: {
  frameRef: Ref<HTMLIFrameElement>;
  srcdoc: string;
  title: string;
  viewport: DesignViewport;
  zoom?: Zoom;
  onFitScale?: (scale: number) => void;
  onZoomChange?: (next: Zoom) => void;
  wheelBridgeRef?: RefObject<((wheel: PreviewWheelPayload) => void) | null>;
  overlay?: (transform: FrameTransform) => ReactNode;
}) {
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const localFrameRef = useRef<HTMLIFrameElement | null>(null);
  const setCombinedFrameRef = useCallback(
    (node: HTMLIFrameElement | null) => {
      localFrameRef.current = node;
      if (typeof frameRef === 'function') frameRef(node);
      else if (frameRef !== null)
        (frameRef as { current: HTMLIFrameElement | null }).current = node;
    },
    [frameRef],
  );
  const base = frameTransform(viewport, useSize(canvas));
  useEffect(() => {
    if (base !== null) onFitScale?.(base.scale);
  }, [base?.scale, onFitScale]);
  const scale = zoom === 'fit' ? (base?.scale ?? 1) : zoom;
  const transform = base === null ? null : { width: base.width, height: base.height, scale };
  const applyWheel = usePinchZoom({
    stage: canvas,
    content: stage,
    scale,
    onChange: onZoomChange ?? noop,
  });
  useEffect(() => {
    if (wheelBridgeRef === undefined) return;
    wheelBridgeRef.current = (wheel) => {
      const frame = localFrameRef.current;
      if (frame === null) return;
      const rect = frame.getBoundingClientRect();
      const ratioX = rect.width / Math.max(1, frame.offsetWidth);
      const ratioY = rect.height / Math.max(1, frame.offsetHeight);
      applyWheel(
        wheel.deltaY,
        wheel.deltaMode,
        rect.left + wheel.clientX * ratioX,
        rect.top + wheel.clientY * ratioY,
      );
    };
    return () => {
      wheelBridgeRef.current = null;
    };
  }, [wheelBridgeRef, applyWheel]);
  const fitted = VIEWPORT_SIZE[viewport] !== null;
  const scrollable = fitted || zoom !== 'fit';
  return (
    <div
      ref={setCanvas}
      data-testid="design-canvas"
      data-viewport={viewport}
      className={
        scrollable
          ? `relative flex min-h-0 flex-1 overflow-auto overscroll-contain bg-(--surface-1) ${fitted ? 'p-6' : ''}`
          : 'relative flex min-h-0 flex-1 overflow-hidden bg-background'
      }
    >
      {transform !== null && (
        <div
          ref={setStage}
          data-testid="design-stage"
          className={
            scrollable
              ? 'relative m-auto flex-none overflow-hidden rounded-(--radius-tile) shadow-(--e1)'
              : 'relative size-full'
          }
          style={
            scrollable
              ? {
                  width: transform.width * transform.scale,
                  height: transform.height * transform.scale,
                }
              : undefined
          }
        >
          <iframe
            ref={setCombinedFrameRef}
            data-testid="design-frame"
            title={title}
            sandbox={FRAME_SANDBOX}
            srcDoc={srcdoc}
            className="absolute top-0 left-0 block origin-top-left border-0 bg-(--page-preview)"
            style={
              {
                width: transform.width,
                height: transform.height,
                transform: transform.scale === 1 ? undefined : `scale(${transform.scale})`,
              } as CSSProperties
            }
          />
          {overlay?.(transform)}
        </div>
      )}
    </div>
  );
}
