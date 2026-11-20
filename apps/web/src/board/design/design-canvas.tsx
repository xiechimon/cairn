import type {
  DesignCommentRecord,
  DesignViewport,
  DesignTarget as ElementTarget,
} from '@cairn/shared';
import { type RefObject, useEffect, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { useCommentBridge } from './design-bridge.js';
import { type CommentActions, CommentList, CommentPin } from './design-comment-list.js';
import { CommentPopover } from './design-comment-popover.js';
import { DesignFrame } from './design-frame.js';

export interface CommentDraftHandlers {
  busy: boolean;
  save: (target: ElementTarget, note: string, done: () => void) => void;
  send: ((target: ElementTarget, note: string, done: () => void) => void) | undefined;
}

export function DesignCanvas({
  frameRef,
  srcdoc,
  title,
  viewport,
  commenting,
  onStopCommenting,
  comments,
  listOpen,
  onListOpen,
  readOnly,
  actions,
  draft,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  srcdoc: string;
  title: string;
  viewport: DesignViewport;
  commenting: boolean;
  onStopCommenting: () => void;
  comments: readonly DesignCommentRecord[];
  listOpen: boolean;
  onListOpen: (open: boolean) => void;
  readOnly: boolean;
  actions: CommentActions;
  draft: CommentDraftHandlers;
}) {
  const { t } = useI18n();
  const bridge = useCommentBridge({ frameRef, commenting, comments });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { picked, clearPicked } = bridge;
  useEffect(() => {
    if (!commenting) clearPicked();
  }, [commenting, clearPicked]);
  useEffect(() => {
    if (!commenting || picked !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onStopCommenting();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commenting, picked, onStopCommenting]);
  const pins = comments.flatMap((comment) => {
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
      <DesignFrame
        frameRef={frameRef}
        srcdoc={srcdoc}
        title={title}
        viewport={viewport}
        overlay={(transform) => (
          <div
            data-testid="design-overlay"
            data-commenting={commenting || undefined}
            className="pointer-events-none absolute inset-0 overflow-hidden"
          >
            {bridge.hover !== null && picked === null && (
              <div
                data-testid="design-hover-outline"
                className="absolute rounded-xs outline-2 outline-(--accent) outline-offset-1"
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
                className="absolute rounded-xs outline-2 outline-(--accent) outline-offset-1"
                style={{
                  left: picked.position.x * transform.scale,
                  top: picked.position.y * transform.scale,
                  width: picked.position.width * transform.scale,
                  height: picked.position.height * transform.scale,
                }}
              />
            )}
            {pins.map(({ comment, position }) => (
              <div
                key={comment.id}
                className="absolute"
                style={{ left: position.x * transform.scale, top: position.y * transform.scale }}
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
            ))}
            {picked !== null && commenting && (
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
      {listOpen && (
        <CommentList
          comments={comments}
          located={bridge.located}
          readOnly={readOnly}
          focusedId={focusedId}
          actions={actions}
          onClose={() => onListOpen(false)}
        />
      )}
    </div>
  );
}
