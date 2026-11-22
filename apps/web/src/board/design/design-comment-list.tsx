import { DESIGN_LIMITS, type DesignCommentRecord, type DesignCommentStatus } from '@cairn/shared';
import { useState } from 'react';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import type { Located } from './design-bridge.js';

const STATUS_LABEL: Record<DesignCommentStatus, string> = {
  open: '未发送',
  sent: '已发给 agent',
  resolved: '已解决',
};

function markHref(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}

export interface CommentActions {
  edit: (id: string, note: string) => void;
  remove: (id: string) => void;
  resolve: (id: string) => void;
  reopen: (id: string) => void;
}

export function CommentPin({
  pin,
  status,
  onClick,
}: {
  pin: number;
  status: DesignCommentStatus;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      data-testid="design-pin"
      data-pin={pin}
      data-status={status}
      aria-label={t('评论 {n}', { n: pin })}
      onClick={onClick}
      className="pointer-events-auto size-5.5 -translate-x-1/2 -translate-y-full rounded-full rounded-bl-none bg-foreground text-caption leading-none text-background tabular-nums shadow-(--shadow-xs) hover:bg-foreground hover:text-background data-[status=sent]:bg-content-secondary"
    >
      {pin}
    </Button>
  );
}

function CommentRow({
  comment,
  located,
  readOnly,
  focused,
  actions,
}: {
  comment: DesignCommentRecord;
  located: Located | undefined;
  readOnly: boolean;
  focused: boolean;
  actions: CommentActions;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const trimmed = draft?.trim() ?? '';
  return (
    <li
      data-testid="design-comment-row"
      data-pin={comment.pin}
      data-status={comment.status}
      data-anchor={located?.state}
      data-focused={focused || undefined}
      className="flex gap-2.5 border-b border-border px-3 py-3 data-focused:bg-(--surface-1)"
    >
      <span className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-secondary text-caption font-medium text-foreground tabular-nums">
        {comment.pin}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {draft !== null ? (
          <>
            <Textarea
              data-testid="design-comment-edit-note"
              aria-label={t('评论内容')}
              maxLength={DESIGN_LIMITS.noteChars}
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              className="min-h-14 resize-none text-ui"
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" size="xs" onClick={() => setDraft(null)}>
                {t('取消')}
              </Button>
              <Button
                variant="outline"
                size="xs"
                data-testid="design-comment-edit-save"
                disabled={trimmed === ''}
                onClick={() => {
                  actions.edit(comment.id, trimmed);
                  setDraft(null);
                }}
              >
                {t('保存')}
              </Button>
            </div>
          </>
        ) : (
          <p className="m-0 text-ui break-words whitespace-pre-wrap text-foreground">
            {comment.note}
          </p>
        )}
        {comment.markAttachmentId !== null && (
          <a
            href={markHref(comment.markAttachmentId)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="design-comment-mark"
            className="block overflow-hidden rounded-(--radius-tile) border border-border"
          >
            <img
              src={markHref(comment.markAttachmentId)}
              alt={t('标注图 {n}', { n: comment.pin })}
              className="block max-h-40 w-full object-cover object-top"
            />
          </a>
        )}
        <p className="m-0 truncate text-meta text-content-tertiary">
          {[
            comment.text !== '' ? `${comment.label}「${comment.text}」` : comment.label,
            `v${comment.versionSeq}`,
            t(STATUS_LABEL[comment.status]),
          ].join(' · ')}
        </p>
        {located?.state === 'lost' && (
          <p data-testid="design-comment-lost" className="m-0 text-meta text-content-secondary">
            {t('在 v{n} 上提的，这一版没找到', { n: comment.versionSeq })}
          </p>
        )}
        {located?.state === 'moved' && (
          <p data-testid="design-comment-moved" className="m-0 text-meta text-content-secondary">
            {t('元素位置变了，已重新对上')}
          </p>
        )}
        {!readOnly && draft === null && (
          <div className="-ml-2 flex flex-wrap gap-0.5">
            {comment.status === 'open' && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="design-comment-edit"
                  className="text-content-secondary"
                  onClick={() => setDraft(comment.note)}
                >
                  {t('编辑')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  data-testid="design-comment-delete"
                  className="text-content-secondary"
                  onClick={() => actions.remove(comment.id)}
                >
                  {t('删除')}
                </Button>
              </>
            )}
            {comment.status === 'resolved' ? (
              <Button
                variant="ghost"
                size="xs"
                data-testid="design-comment-reopen"
                className="text-content-secondary"
                onClick={() => actions.reopen(comment.id)}
              >
                {t('重新打开')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                data-testid="design-comment-resolve"
                className="text-content-secondary"
                onClick={() => actions.resolve(comment.id)}
              >
                {t('解决')}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function CommentList({
  comments,
  located,
  readOnly,
  focusedId,
  actions,
  onClose,
}: {
  comments: readonly DesignCommentRecord[];
  located: ReadonlyMap<string, Located>;
  readOnly: boolean;
  focusedId: string | null;
  actions: CommentActions;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      data-testid="design-comment-list"
      aria-label={t('评论')}
      className="absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-border bg-background shadow-(--shadow-popover)"
    >
      <div className="flex h-10 flex-none items-center justify-between border-b border-border pr-1 pl-3">
        <h3 className="m-0 text-ui font-medium text-foreground">{t('评论')}</h3>
        <IconTooltip
          label={t('关闭评论列表')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="design-comment-list-close"
              className="text-content-secondary"
              onClick={onClose}
            />
          }
        >
          <X aria-hidden className="size-4" />
        </IconTooltip>
      </div>
      {comments.length === 0 ? (
        <p
          data-testid="design-comments-empty"
          className="m-0 px-3 py-4 text-ui text-content-secondary"
        >
          {t('还没有评论。点「评论」后在页面上点一个元素。')}
        </p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              located={located.get(comment.id)}
              readOnly={readOnly}
              focused={comment.id === focusedId}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
