import {
  artifactCommentState,
  type DesignCommentRecord,
  type DesignViewport,
  type DesignTarget as ElementTarget,
} from '@cairn/shared';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import {
  DrawLayer,
  MARK_COLOR,
  type Mark,
  useDrawing,
} from '../../vendor-open-design/draw-overlay.js';
import {
  hasBlockingLayer,
  stepZoom,
  type Zoom,
  zoomShortcutAction,
} from '../artifact/viewers/zoom.js';
import {
  type PreviewKeyPayload,
  type PreviewWheelPayload,
  useCommentBridge,
} from './design-bridge.js';
import {
  type CommentActions,
  CommentList,
  CommentPin,
  type CommentSend,
} from './design-comment-list.js';
import { CommentPopover } from './design-comment-popover.js';
import { DesignFrame } from './design-frame.js';
import { MarkBar } from './design-markup.js';

export interface CommentDraftHandlers {
  busy: boolean;
  save: (target: ElementTarget, note: string, done: () => void) => void;
  send: ((target: ElementTarget, note: string, done: () => void) => void) | undefined;
}

export interface MarkInput {
  frame: HTMLIFrameElement;
  marks: readonly Mark[];
  note: string;
}

export interface MarkHandlers {
  busy: boolean;
  save: (input: MarkInput, done: () => void) => void;
  send: ((input: MarkInput, done: () => void) => void) | undefined;
}

export function DesignCanvas({
  frameRef,
  srcdoc,
  title,
  viewport,
  zoom = 'fit',
  fitScale = 1,
  onFitScale,
  onZoomChange,
  onEscape,
  commenting,
  onStopCommenting,
  marking,
  onStopMarking,
  mark,
  comments,
  listOpen,
  onListOpen,
  readOnly,
  actions,
  draft,
  send,
  retarget,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  srcdoc: string;
  title: string;
  viewport: DesignViewport;
  zoom?: Zoom;
  fitScale?: number;
  onFitScale?: (scale: number) => void;
  onZoomChange?: (next: Zoom) => void;
  onEscape?: () => void;
  commenting: boolean;
  onStopCommenting: () => void;
  marking: boolean;
  onStopMarking: () => void;
  mark: MarkHandlers;
  comments: readonly DesignCommentRecord[];
  listOpen: boolean;
  onListOpen: (open: boolean) => void;
  readOnly: boolean;
  actions: CommentActions;
  draft: CommentDraftHandlers;
  send?: CommentSend | undefined;
  retarget?: ((target: ElementTarget) => void) | undefined;
}) {
  const { t } = useI18n();
  const wheelBridgeRef = useRef<((wheel: PreviewWheelPayload) => void) | null>(null);
  const scale = zoom === 'fit' ? fitScale : zoom;
  const onPreviewWheel = useCallback(
    (wheel: PreviewWheelPayload) => wheelBridgeRef.current?.(wheel),
    [],
  );
  const pickedRef = useRef<ElementTarget | null>(null);
  const onPreviewKeyDown = useCallback(
    (event: PreviewKeyPayload) => {
      if (event.key === 'Escape') {
        if (commenting && pickedRef.current !== null) return;
        if (marking) onStopMarking();
        else if (commenting) onStopCommenting();
        else onEscape?.();
        return;
      }
      const action = zoomShortcutAction(event);
      if (action === null || onZoomChange === undefined) return;
      if (action === 'fit') onZoomChange('fit');
      else onZoomChange(stepZoom(scale, action === 'in' ? 1 : -1));
    },
    [marking, commenting, onStopMarking, onStopCommenting, onEscape, onZoomChange, scale],
  );
  const bridge = useCommentBridge({
    frameRef,
    commenting,
    comments,
    onPreviewWheel,
    onPreviewKeyDown,
  });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { picked, clearPicked } = bridge;
  pickedRef.current = picked;
  const drawing = useDrawing();
  const { clear } = drawing;
  useEffect(() => {
    if (!marking) clear();
  }, [marking, clear]);
  const submitMark = (handler: MarkHandlers['save']) => (note: string) => {
    const frame = frameRef.current;
    if (frame === null) return;
    handler({ frame, marks: drawing.marks, note }, onStopMarking);
  };
  useEffect(() => {
    if (!commenting) clearPicked();
  }, [commenting, clearPicked]);
  useEffect(() => {
    clearPicked();
  }, [viewport, clearPicked]);
  useEffect(() => {
    if (picked === null || retarget === undefined) return;
    retarget(picked);
    clearPicked();
  }, [picked, retarget, clearPicked]);
  useEffect(() => {
    if (!commenting || picked !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        hasBlockingLayer()
      )
        return;
      event.preventDefault();
      onStopCommenting();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commenting, picked, onStopCommenting]);
  const pins = comments.flatMap((comment) => {
    if (comment.markAttachmentId !== null)
      return comment.status !== 'resolved' ? [{ comment, position: comment.position }] : [];
    const where = bridge.located.get(comment.id);
    return comment.status !== 'resolved' && where?.position != null && where.state !== 'lost'
      ? [{ comment, position: where.position }]
      : [];
  });
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {bridge.unsupported && (
        <p
          data-testid="design-comment-unsupported"
          role="status"
          className="m-0 flex-none border-b border-border bg-(--surface-1) px-3 py-2 text-ui text-content-secondary"
        >
          {t('这个页面不支持点选评论')}
        </p>
      )}
      {marking && (
        <MarkBar
          drawing={drawing}
          busy={mark.busy}
          onCancel={onStopMarking}
          onSave={submitMark(mark.save)}
          onSend={mark.send === undefined ? undefined : submitMark(mark.send)}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DesignFrame
            frameRef={frameRef}
            srcdoc={srcdoc}
            title={title}
            viewport={viewport}
            zoom={zoom}
            {...(onFitScale !== undefined ? { onFitScale } : {})}
            {...(onZoomChange !== undefined ? { onZoomChange } : {})}
            wheelBridgeRef={wheelBridgeRef}
            overlay={(transform) => (
              <div
                data-testid="design-overlay"
                data-commenting={commenting || undefined}
                className="pointer-events-none absolute inset-0 overflow-hidden"
              >
                {bridge.hover !== null && picked === null && (
                  <div
                    data-testid="design-hover-outline"
                    className="absolute rounded-xs border border-(--background) outline-2 outline-(--focus-ring)"
                    style={{
                      left: bridge.hover.position.x * transform.scale,
                      top: bridge.hover.position.y * transform.scale,
                      width: bridge.hover.position.width * transform.scale,
                      height: bridge.hover.position.height * transform.scale,
                    }}
                  />
                )}
                {picked !== null && (
                  <div
                    className="absolute rounded-xs border border-(--background) outline-2 outline-(--focus-ring)"
                    style={{
                      left: picked.position.x * transform.scale,
                      top: picked.position.y * transform.scale,
                      width: picked.position.width * transform.scale,
                      height: picked.position.height * transform.scale,
                    }}
                  />
                )}
                {marking && (
                  <DrawLayer
                    drawing={drawing}
                    color={MARK_COLOR}
                    label={t('标注画布')}
                    textLabel={t('标注文字')}
                  />
                )}
                {pins.map(({ comment, position }) => {
                  const left = position.x * transform.scale;
                  const top = position.y * transform.scale;
                  const maxW = transform.width * transform.scale;
                  const maxH = transform.height * transform.scale;
                  const inViewX =
                    (position.x + position.width) * transform.scale > 0 && left <= maxW;
                  const inViewY =
                    (position.y + position.height) * transform.scale > 0 && top <= maxH;
                  const pinLeft = inViewX
                    ? Math.min(Math.max(11, left), Math.max(11, maxW - 11))
                    : left;
                  const pinTop = inViewY ? Math.min(Math.max(22, top), maxH) : top;
                  return (
                    <div
                      key={comment.id}
                      className="absolute"
                      style={{
                        left: pinLeft,
                        top: pinTop,
                      }}
                    >
                      <CommentPin
                        pin={comment.pin}
                        status={comment.status}
                        onClick={() => {
                          setFocusedId(comment.id);
                          onListOpen(true);
                        }}
                      />
                    </div>
                  );
                })}
                {picked !== null && commenting && retarget === undefined && (
                  <CommentPopover
                    key={`${picked.selector}:${picked.position.x}:${picked.position.y}`}
                    target={picked}
                    transform={transform}
                    busy={draft.busy}
                    onCancel={clearPicked}
                    onSave={(note) => draft.save(picked, note, clearPicked)}
                    onSend={
                      draft.send === undefined
                        ? undefined
                        : (note) => draft.send?.(picked, note, clearPicked)
                    }
                  />
                )}
              </div>
            )}
          />
        </div>
        {listOpen && (
          <CommentList
            comments={comments}
            stateOf={(comment) =>
              artifactCommentState({
                status: comment.status,
                handledSeq: comment.handledSeq,
                anchorResolves: bridge.located.get(comment.id)?.state !== 'lost',
              })
            }
            send={send}
            located={bridge.located}
            readOnly={readOnly}
            focusedId={focusedId}
            actions={actions}
            onClose={() => onListOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
