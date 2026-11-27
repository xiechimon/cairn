import {
  type DesignCommentRecord,
  type DesignRect,
  designRectSchema,
  designTargetSchema,
  type DesignTarget as ElementTarget,
} from '@cairn/shared';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { randomId } from '../../lib/random-id.js';
import { COMMENT_BRIDGE_MESSAGES } from '../../vendor-open-design/comment-bridge.js';

export type AnchorState = 'anchored' | 'moved' | 'lost';

export interface Located {
  state: AnchorState;
  position: DesignRect | null;
}

const BRIDGE_WAIT_MS = 3000;
const ANCHOR_STATES: readonly AnchorState[] = ['anchored', 'moved', 'lost'];

function targetOf(value: unknown): ElementTarget | null {
  const parsed = designTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function locatedOf(value: unknown): Map<string, Located> | null {
  if (!Array.isArray(value)) return null;
  const out = new Map<string, Located>();
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue;
    const { id, state, position } = row as Record<string, unknown>;
    if (typeof id !== 'string' || !ANCHOR_STATES.includes(state as AnchorState)) continue;
    const rect = designRectSchema.safeParse(position);
    out.set(id, { state: state as AnchorState, position: rect.success ? rect.data : null });
  }
  return out;
}

export interface PreviewWheelPayload {
  deltaY: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
}

export interface PreviewKeyPayload {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface CommentBridge {
  ready: boolean;
  unsupported: boolean;
  hover: ElementTarget | null;
  hoverSlide: number | null;
  picked: ElementTarget | null;
  pickedSlide: number | null;
  clearPicked: () => void;
  located: ReadonlyMap<string, Located>;
}

function slideOf(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function useCommentBridge({
  frameRef,
  commenting,
  comments,
  onPreviewWheel,
  onPreviewKeyDown,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  commenting: boolean;
  comments: readonly DesignCommentRecord[];
  onPreviewWheel?: (wheel: PreviewWheelPayload) => void;
  onPreviewKeyDown?: (key: PreviewKeyPayload) => void;
}): CommentBridge {
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(false);
  const [hover, setHover] = useState<ElementTarget | null>(null);
  const [hoverSlide, setHoverSlide] = useState<number | null>(null);
  const [picked, setPicked] = useState<ElementTarget | null>(null);
  const [pickedSlide, setPickedSlide] = useState<number | null>(null);
  const [located, setLocated] = useState<ReadonlyMap<string, Located>>(new Map());
  const requestRef = useRef('');
  const frameRequest = useRef<number | null>(null);

  const post = useCallback(
    (message: Record<string, unknown>) =>
      frameRef.current?.contentWindow?.postMessage(message, '*'),
    [frameRef],
  );

  const locate = useCallback(() => {
    const items = comments
      .filter((comment) => comment.markAttachmentId === null)
      .map((comment) => ({
        id: comment.id,
        selector: comment.selector,
        elementId: comment.elementId,
        text: comment.text,
        label: comment.label,
      }));
    const requestId = randomId();
    requestRef.current = requestId;
    post({ type: COMMENT_BRIDGE_MESSAGES.locate, requestId, items });
  }, [post, comments]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current?.contentWindow;
      if (frame == null || event.source !== frame) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const message = data as Record<string, unknown>;
      switch (message.type) {
        case COMMENT_BRIDGE_MESSAGES.ready:
          setReady(true);
          return;
        case COMMENT_BRIDGE_MESSAGES.hover:
          setHover(targetOf(message.target));
          setHoverSlide(slideOf(message.slide));
          return;
        case COMMENT_BRIDGE_MESSAGES.target: {
          const target = targetOf(message.target);
          if (target === null) return;
          setPicked(target);
          setPickedSlide(slideOf(message.slide));
          return;
        }
        case COMMENT_BRIDGE_MESSAGES.located: {
          if (message.requestId !== requestRef.current) return;
          const next = locatedOf(message.results);
          if (next !== null) setLocated(next);
          return;
        }
        case COMMENT_BRIDGE_MESSAGES.scroll:
          if (frameRequest.current !== null) return;
          frameRequest.current = requestAnimationFrame(() => {
            frameRequest.current = null;
            locate();
          });
          return;
        case COMMENT_BRIDGE_MESSAGES.wheel:
          if (
            typeof message.deltaY === 'number' &&
            typeof message.deltaMode === 'number' &&
            typeof message.clientX === 'number' &&
            typeof message.clientY === 'number'
          ) {
            onPreviewWheel?.({
              deltaY: message.deltaY,
              deltaMode: message.deltaMode,
              clientX: message.clientX,
              clientY: message.clientY,
            });
          }
          return;
        case COMMENT_BRIDGE_MESSAGES.keydown:
          if (
            typeof message.key === 'string' &&
            typeof message.code === 'string' &&
            typeof message.metaKey === 'boolean' &&
            typeof message.ctrlKey === 'boolean' &&
            typeof message.altKey === 'boolean'
          ) {
            onPreviewKeyDown?.({
              key: message.key,
              code: message.code,
              metaKey: message.metaKey,
              ctrlKey: message.ctrlKey,
              altKey: message.altKey,
            });
          }
          return;
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
    };
  }, [frameRef, locate, onPreviewWheel, onPreviewKeyDown]);

  useEffect(() => {
    if (!ready) return;
    post({ type: COMMENT_BRIDGE_MESSAGES.mode, enabled: commenting });
    if (!commenting) setHover(null);
  }, [ready, commenting, post]);

  useEffect(() => {
    if (ready) locate();
  }, [ready, locate]);

  useEffect(() => {
    if (!commenting || ready) return;
    const timer = window.setTimeout(() => setWaited(true), BRIDGE_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [commenting, ready]);

  return {
    ready,
    unsupported: commenting && !ready && waited,
    hover: commenting ? hover : null,
    hoverSlide,
    picked,
    pickedSlide,
    clearPicked: useCallback(() => setPicked(null), []),
    located,
  };
}
