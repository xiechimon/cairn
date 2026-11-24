import type { DesignCommentRecord } from '@cairn/shared';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDesignComments, useDesignMutations, useDesignPages } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { Button } from '../../components/ui/button.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { type DesignTarget, pickPage } from './design-route.js';

export interface PendingComments {
  count: number;
  chips: ReactNode;
  emptyDraftText: string;
}

export function commentSubject(comment: Pick<DesignCommentRecord, 'text' | 'label'>): string {
  return comment.text !== '' ? comment.text : comment.label;
}

export function useDesignPageName(target: DesignTarget | null): string | null {
  const { live } = useLiveData();
  const pagesQ = useDesignPages(target?.todoId ?? '', live && target !== null);
  if (target === null) return null;
  return pickPage(pagesQ.data?.pages ?? [], target.fileName)?.fileName ?? null;
}

export function useDesignComposer(
  target: DesignTarget | null,
): (PendingComments & { ids: readonly string[] }) | null {
  const { t } = useI18n();
  const { live } = useLiveData();
  const fileName = useDesignPageName(target);
  const commentsQ = useDesignComments(target?.todoId ?? '', fileName, live && target !== null);
  const { deleteComment } = useDesignMutations(target?.todoId ?? '', fileName ?? '');
  if (target === null) return null;
  const open = (commentsQ.data ?? []).filter((comment) => comment.status === 'open');
  if (open.length === 0) return null;
  return {
    ids: open.map((comment) => comment.id),
    count: open.length,
    emptyDraftText: t('按下面的设计评论改。'),
    chips: (
      <div data-testid="design-comment-chips" className="mb-2 flex flex-wrap gap-1.5">
        {open.map((comment) => (
          <span
            key={comment.id}
            data-testid="design-comment-chip"
            data-pin={comment.pin}
            className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-background pr-0.5 pl-2 text-meta text-foreground"
          >
            <span className="flex-none font-medium tabular-nums">{comment.pin}</span>
            <span className="min-w-0 max-w-88 truncate">
              {commentSubject(comment)} · {comment.note}
            </span>
            <IconTooltip
              label={t('删除评论 {n}', { n: comment.pin })}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  data-testid="design-comment-chip-remove"
                  className="size-5 flex-none rounded-full text-content-tertiary hover:bg-(--hover-1) hover:text-foreground"
                  onClick={() =>
                    deleteComment.mutate(comment.id, {
                      onError: (error) => toastError(t('评论未能删除'), error),
                    })
                  }
                />
              }
            >
              <X aria-hidden />
            </IconTooltip>
          </span>
        ))}
      </div>
    ),
  };
}
