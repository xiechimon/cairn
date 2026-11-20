import type { DesignViewport } from '@cairn/shared';
import { type CSSProperties, type ReactNode, type Ref, useLayoutEffect, useState } from 'react';

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

export function DesignFrame({
  frameRef,
  srcdoc,
  title,
  viewport,
  overlay,
}: {
  frameRef: Ref<HTMLIFrameElement>;
  srcdoc: string;
  title: string;
  viewport: DesignViewport;
  overlay?: (transform: FrameTransform) => ReactNode;
}) {
  const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
  const transform = frameTransform(viewport, useSize(canvas));
  const fitted = VIEWPORT_SIZE[viewport] !== null;
  return (
    <div
      ref={setCanvas}
      data-testid="design-canvas"
      data-viewport={viewport}
      className={
        fitted
          ? 'relative flex min-h-0 flex-1 justify-center overflow-hidden bg-(--surface-1) p-6'
          : 'relative flex min-h-0 flex-1 overflow-hidden bg-background'
      }
    >
      {transform !== null && (
        <div
          data-testid="design-stage"
          className={
            fitted
              ? 'relative flex-none overflow-hidden rounded-(--radius-tile) shadow-(--e1)'
              : 'relative size-full'
          }
          style={
            fitted
              ? {
                  width: transform.width * transform.scale,
                  height: transform.height * transform.scale,
                }
              : undefined
          }
        >
          <iframe
            ref={frameRef}
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
