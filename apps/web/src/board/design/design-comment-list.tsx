import {
  type ArtifactCommentState,
  DESIGN_LIMITS,
  type DesignCommentRecord,
  type DesignCommentStatus,
  describeAnchor,
} from '@cairn/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import { StatusChip, type StatusTone } from '../../components/ui/status-chip.js';
import { Textarea } from '../../components/ui/textarea.js';
import { useI18n } from '../../i18n/provider.js';
import type { Located } from './design-bridge.js';

const STATE_LABEL: Record<ArtifactCommentState, string> = {
  pending: '待处理',
  working: '处理中',
  done: '已改',
  stale: '已失效',
};

const STATE_TONE: Record<ArtifactCommentState, StatusTone> = {
  pending: 'confirm',
  working: 'idle',
  done: 'done',
  stale: 'failed',
};

type Filter = 'all' | 'open' | 'done';

export function commentWhere(comment: DesignCommentRecord): string {
  if (comment.anchor !== null && comment.anchor.type !== 'slide')
    return describeAnchor(comment.anchor);
  const element = comment.text !== '' ? `${comment.label}「${comment.text}」` : comment.label;
  return comment.anchor === null ? element : `${describeAnchor(comment.anchor)} · ${element}`;
}

function markHref(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}

export interface CommentActions {
  edit: (id: string, note: string, onError?: () => void) => void;
  remove: (id: string) => void;
  resolve: (id: string) => void;
  reopen: (id: string) => void;
  retarget?: (id: string) => void;
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
  state,
  located,
  readOnly,
  focused,
  actions,
  onPick,
}: {
  comment: DesignCommentRecord;
  state: ArtifactCommentState;
  located: Located | undefined;
  readOnly: boolean;
  focused: boolean;
  actions: CommentActions;
  onPick: ((comment: DesignCommentRecord) => void) | undefined;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const trimmed = draft?.trim() ?? '';
  return (
    <li
      data-testid="design-comment-row"
      data-pin={comment.pin}
      data-status={comment.status}
      data-state={state}
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
                  actions.edit(comment.id, trimmed, () => setDraft(trimmed));
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
          {onPick === undefined ? (
            `${commentWhere(comment)} · v${comment.versionSeq}`
          ) : (
            <Button
              variant="link"
              size="xs"
              data-testid="design-comment-where"
              onClick={() => onPick(comment)}
              className="h-auto max-w-full truncate p-0 text-meta font-normal text-content-tertiary"
            >
              {`${commentWhere(comment)} · v${comment.versionSeq}`}
            </Button>
          )}
        </p>
        <div className="flex">
          <StatusChip tone={STATE_TONE[state]} className="text-meta">
            <span data-testid="design-comment-state">{t(STATE_LABEL[state])}</span>
          </StatusChip>
        </div>
        {state === 'stale' && located?.state !== 'lost' && (
          <p data-testid="design-comment-stale" className="m-0 text-meta text-content-secondary">
            {t('原来的位置在新版里找不到了')}
          </p>
        )}
        {located?.state === 'lost' && (
          <p data-testid="design-comment-lost" className="m-0 text-meta text-content-secondary">
            {t('在 v{n} 上提出，这一版中未找到', { n: comment.versionSeq })}
          </p>
        )}
        {located?.state === 'moved' && (
          <p data-testid="design-comment-moved" className="m-0 text-meta text-content-secondary">
            {t('元素位置变了，已重新对上')}
          </p>
        )}
        {!readOnly && draft === null && (
          <div className="-ml-2 flex flex-wrap gap-0.5">
            {state === 'stale' && actions.retarget !== undefined && (
              <Button
                variant="ghost"
                size="xs"
                data-testid="design-comment-retarget"
                className="text-content-secondary"
                onClick={() => actions.retarget?.(comment.id)}
              >
                {t('重新指位置')}
              </Button>
            )}
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

export interface CommentSend {
  busy: boolean;
  run: (ids: readonly string[]) => void;
}

export function CommentList({
  comments,
  stateOf,
  located = new Map(),
  readOnly,
  focusedId,
  actions,
  send,
  onPick,
  onClose,
}: {
  comments: readonly DesignCommentRecord[];
  stateOf: (comment: DesignCommentRecord) => ArtifactCommentState;
  located?: ReadonlyMap<string, Located>;
  readOnly: boolean;
  focusedId: string | null;
  actions: CommentActions;
  send?: CommentSend | undefined;
  onPick?: (comment: DesignCommentRecord) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const rows = comments.map((comment) => ({ comment, state: stateOf(comment) }));
  const shown = rows.filter(({ state }) =>
    filter === 'all' ? true : filter === 'done' ? state === 'done' : state !== 'done',
  );
  const pendingIds = rows
    .filter(({ state }) => state === 'pending')
    .map(({ comment }) => comment.id);
  return (
    <section
      data-testid="design-comment-list"
      aria-label={t('评论')}
      className="flex w-80 max-w-full flex-none flex-col border-l border-border bg-background max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:right-0 max-[760px]:z-20 max-[760px]:shadow-(--shadow-popover)"
    >
      <div className="flex h-10 flex-none items-center justify-between border-b border-border pr-1 pl-3">
        <h3 className="m-0 text-ui font-medium text-foreground">{t('批注')}</h3>
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
      {comments.length > 0 && (
        <div className="flex-none px-3 pt-2.5 pb-1">
          <SegmentedTabs
            value={filter}
            label={t('筛选批注')}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('全部'), testId: 'design-comment-filter-all' },
              { value: 'open', label: t('未改'), testId: 'design-comment-filter-open' },
              { value: 'done', label: t('已改'), testId: 'design-comment-filter-done' },
            ]}
          />
        </div>
      )}
      {comments.length === 0 ? (
        <p
          data-testid="design-comments-empty"
          className="m-0 px-3 py-4 text-ui text-content-secondary"
        >
          {t('暂无评论。点击「评论」后在页面上点击一个元素。')}
        </p>
      ) : (
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {shown.map(({ comment, state }) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              state={state}
              onPick={onPick}
              located={located.get(comment.id)}
              readOnly={readOnly}
              focused={comment.id === focusedId}
              actions={actions}
            />
          ))}
        </ul>
      )}
      {send !== undefined && !readOnly && pendingIds.length > 0 && (
        <div className="mt-auto flex-none border-t border-border p-3">
          <Button
            data-testid="design-comment-send-all"
            className="w-full"
            disabled={send.busy}
            onClick={() => send.run(pendingIds)}
          >
            {t('发给 Coordinator ({n})', { n: pendingIds.length })}
          </Button>
        </div>
      )}
    </section>
  );
}
