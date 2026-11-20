import {
  type DesignCommentRecord,
  type DesignRect,
  designRectSchema,
  designTargetSchema,
  type DesignTarget as ElementTarget,
} from '@cairn/shared';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
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

export interface CommentBridge {
  ready: boolean;
  unsupported: boolean;
  hover: ElementTarget | null;
  picked: ElementTarget | null;
  clearPicked: () => void;
  located: ReadonlyMap<string, Located>;
}

export function useCommentBridge({
  frameRef,
  commenting,
  comments,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  commenting: boolean;
  comments: readonly DesignCommentRecord[];
}): CommentBridge {
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(false);
  const [hover, setHover] = useState<ElementTarget | null>(null);
  const [picked, setPicked] = useState<ElementTarget | null>(null);
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
    const requestId = crypto.randomUUID();
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
          return;
        case COMMENT_BRIDGE_MESSAGES.target: {
          const target = targetOf(message.target);
          if (target !== null) setPicked(target);
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
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      frameRequest.current = null;
    };
  }, [frameRef, locate]);

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
    picked,
    clearPicked: useCallback(() => setPicked(null), []),
    located,
  };
}
