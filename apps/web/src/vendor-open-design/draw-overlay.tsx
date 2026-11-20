// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/components/PreviewDrawOverlay.tsx
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Textarea } from '../components/ui/textarea.js';

export type MarkTool = 'box' | 'pen' | 'text';

interface Point {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Mark =
  | { kind: 'box'; rect: NormalizedRect }
  | { kind: 'stroke'; points: Point[] }
  | { kind: 'text'; id: number; x: number; y: number; text: string };

export const MARK_COLOR = '#ff3b30';
const STROKE_WIDTH = 4;
const TEXT_FONT_FRACTION = 0.03;
const TEXT_LINE_HEIGHT = 1.25;
const TEXT_MIN_FONT_PX = 12;
const TEXT_FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
const MIN_BOX = 0.006;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizedRectFromPoints(a: Point, b: Point): NormalizedRect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    x: left,
    y: top,
    width: Math.max(0, Math.max(a.x, b.x) - left),
    height: Math.max(0, Math.max(a.y, b.y) - top),
  };
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  box: NormalizedRect,
  width: number,
  height: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.002));
  ctx.setLineDash([10, 6]);
  ctx.globalAlpha = 0.1;
  ctx.fillRect(box.x * width, box.y * height, box.width * width, box.height * height);
  ctx.globalAlpha = 1;
  ctx.strokeRect(
    box.x * width,
    box.y * height,
    Math.max(1, box.width * width),
    Math.max(1, box.height * height),
  );
  ctx.restore();
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  width: number,
  height: number,
  lineWidth: number,
  color: string,
) {
  const first = points[0];
  if (first === undefined) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(first.x * width, first.y * height);
  for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * height);
  ctx.stroke();
  ctx.restore();
}

function textFontPx(height: number): number {
  return Math.max(TEXT_MIN_FONT_PX, TEXT_FONT_FRACTION * height);
}

function drawTexts(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
  width: number,
  height: number,
  scale: number,
  color: string,
) {
  const fontPx = textFontPx(height / scale) * scale;
  const lineHeight = fontPx * TEXT_LINE_HEIGHT;
  const topPad = (lineHeight - fontPx) / 2;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `600 ${fontPx}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(255,255,255,0.75)';
  ctx.shadowBlur = Math.max(1, fontPx * 0.14);
  for (const mark of marks) {
    if (mark.kind !== 'text' || mark.text.trim() === '') continue;
    mark.text.split('\n').forEach((line, index) => {
      ctx.fillText(line, mark.x * width, mark.y * height + topPad + index * lineHeight);
    });
  }
  ctx.restore();
}

function paint(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
  width: number,
  height: number,
  scale: number,
  color: string,
  withText: boolean,
) {
  for (const mark of marks) {
    if (mark.kind === 'box') drawBox(ctx, mark.rect, width, height, color);
    if (mark.kind === 'stroke')
      drawStroke(ctx, mark.points, width, height, STROKE_WIDTH * scale, color);
  }
  if (withText) drawTexts(ctx, marks, width, height, scale, color);
}

export function markBounds(marks: readonly Mark[]): NormalizedRect | null {
  const rects = marks.flatMap((mark): NormalizedRect[] => {
    if (mark.kind === 'box') return [mark.rect];
    if (mark.kind === 'text')
      return mark.text.trim() === '' ? [] : [{ x: mark.x, y: mark.y, width: 0, height: 0 }];
    if (mark.points.length === 0) return [];
    const xs = mark.points.map((point) => point.x);
    const ys = mark.points.map((point) => point.y);
    return [
      normalizedRectFromPoints(
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
      ),
    ];
  });
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  return normalizedRectFromPoints(
    { x: left, y: top },
    {
      x: Math.max(...rects.map((rect) => rect.x + rect.width)),
      y: Math.max(...rects.map((rect) => rect.y + rect.height)),
    },
  );
}

export function hasInk(marks: readonly Mark[]): boolean {
  return marks.some((mark) => mark.kind !== 'text' || mark.text.trim() !== '');
}

export async function bakeMarks(
  snapshot: { dataUrl: string; w: number; h: number },
  marks: readonly Mark[],
  frameWidth: number,
  color: string,
): Promise<string> {
  const image = new Image();
  image.src = snapshot.dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.w;
  canvas.height = snapshot.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(image, 0, 0, snapshot.w, snapshot.h);
  paint(ctx, marks, snapshot.w, snapshot.h, snapshot.w / Math.max(1, frameWidth), color, true);
  return canvas.toDataURL('image/png');
}

export interface Drawing {
  tool: MarkTool;
  setTool: (tool: MarkTool) => void;
  marks: readonly Mark[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

export function useDrawing(): Drawing & {
  setMarks: (change: (marks: readonly Mark[]) => readonly Mark[]) => void;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  nextTextId: () => number;
} {
  const [tool, setTool] = useState<MarkTool>('box');
  const [history, setHistory] = useState<{ marks: readonly Mark[]; undone: readonly Mark[] }>({
    marks: [],
    undone: [],
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const textId = useRef(0);
  const setMarks = useCallback((change: (marks: readonly Mark[]) => readonly Mark[]) => {
    setHistory((state) => ({ marks: change(state.marks), undone: [] }));
  }, []);
  const undo = useCallback(() => {
    setHistory((state) => {
      const last = state.marks.at(-1);
      return last === undefined
        ? state
        : { marks: state.marks.slice(0, -1), undone: [...state.undone, last] };
    });
    setEditingId(null);
  }, []);
  const redo = useCallback(() => {
    setHistory((state) => {
      const last = state.undone.at(-1);
      return last === undefined
        ? state
        : { marks: [...state.marks, last], undone: state.undone.slice(0, -1) };
    });
  }, []);
  const clear = useCallback(() => {
    setHistory({ marks: [], undone: [] });
    setEditingId(null);
  }, []);
  const { marks, undone } = history;
  return {
    tool,
    setTool,
    marks,
    canUndo: marks.length > 0,
    canRedo: undone.length > 0,
    undo,
    redo,
    clear,
    setMarks,
    editingId,
    setEditingId,
    nextTextId: () => {
      textId.current += 1;
      return textId.current;
    },
  };
}

export function DrawLayer({
  drawing,
  color,
  label,
  textLabel,
}: {
  drawing: ReturnType<typeof useDrawing>;
  color: string;
  label: string;
  textLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftRef = useRef<
    { kind: 'box'; start: Point; current: Point } | { kind: 'stroke'; points: Point[] } | null
  >(null);
  const frameRequest = useRef<number | null>(null);
  const [height, setHeight] = useState(0);
  const { marks, tool, setMarks, editingId, setEditingId, nextTextId } = drawing;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas == null || ctx == null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = window.devicePixelRatio || 1;
    const draft = draftRef.current;
    const pending: Mark[] =
      draft === null
        ? []
        : draft.kind === 'box'
          ? [{ kind: 'box', rect: normalizedRectFromPoints(draft.start, draft.current) }]
          : [{ kind: 'stroke', points: draft.points }];
    paint(ctx, [...marks, ...pending], canvas.width, canvas.height, dpr, color, false);
  }, [marks, color]);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (wrap === null || canvas === null) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(wrap.offsetWidth * dpr));
      canvas.height = Math.max(1, Math.floor(wrap.offsetHeight * dpr));
      setHeight(wrap.offsetHeight);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(
    () => () => {
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    },
    [],
  );

  const pointOf = (event: PointerEvent): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };
  const scheduleRedraw = () => {
    if (frameRequest.current !== null) return;
    frameRequest.current = requestAnimationFrame(() => {
      frameRequest.current = null;
      redraw();
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = pointOf(event);
    if (tool === 'text') {
      const id = nextTextId();
      setMarks((list) => [...list, { kind: 'text', id, x: point.x, y: point.y, text: '' }]);
      setEditingId(id);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    draftRef.current =
      tool === 'box'
        ? { kind: 'box', start: point, current: point }
        : { kind: 'stroke', points: [point] };
    redraw();
  };
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (draft === null) return;
    event.preventDefault();
    if (draft.kind === 'box') draft.current = pointOf(event);
    else draft.points.push(pointOf(event));
    scheduleRedraw();
  };
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current;
    if (draft === null) return;
    draftRef.current = null;
    if (draft.kind === 'box') {
      const rect = normalizedRectFromPoints(draft.start, pointOf(event));
      if (rect.width >= MIN_BOX && rect.height >= MIN_BOX)
        setMarks((list) => [...list, { kind: 'box', rect }]);
      else redraw();
      return;
    }
    if (draft.points.length > 1)
      setMarks((list) => [...list, { kind: 'stroke', points: draft.points }]);
    else redraw();
  };

  const fontPx = textFontPx(height);
  return (
    <div
      ref={wrapRef}
      data-testid="design-draw-layer"
      className="pointer-events-auto absolute inset-0"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="absolute inset-0 size-full cursor-crosshair touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          draftRef.current = null;
          redraw();
        }}
      />
      {marks.map((mark) =>
        mark.kind !== 'text' ? null : (
          <Textarea
            key={mark.id}
            data-testid="design-draw-text"
            aria-label={textLabel}
            rows={Math.max(1, mark.text.split('\n').length)}
            wrap="off"
            value={mark.text}
            readOnly={editingId !== mark.id}
            ref={(node) => {
              if (node !== null && editingId === mark.id && document.activeElement !== node)
                node.focus();
            }}
            onDoubleClick={() => setEditingId(mark.id)}
            onChange={(event) => {
              const text = event.target.value;
              setMarks((list) =>
                list.map((item) =>
                  item.kind === 'text' && item.id === mark.id ? { ...item, text } : item,
                ),
              );
            }}
            onBlur={() => {
              setEditingId(null);
              if (mark.text.trim() === '')
                setMarks((list) =>
                  list.filter((item) => !(item.kind === 'text' && item.id === mark.id)),
                );
            }}
            className="absolute m-0 min-h-0 w-auto resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 font-semibold field-sizing-fixed focus-visible:ring-0 dark:bg-transparent"
            style={{
              left: `${mark.x * 100}%`,
              top: `${mark.y * 100}%`,
              color,
              fontSize: fontPx,
              lineHeight: TEXT_LINE_HEIGHT,
              fontFamily: TEXT_FONT_FAMILY,
              width: `${Math.max(2, ...mark.text.split('\n').map((line) => line.length + 1))}ch`,
            }}
          />
        ),
      )}
    </div>
  );
}
