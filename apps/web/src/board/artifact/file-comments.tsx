import {
  type ArtifactAnchor,
  type ArtifactKind,
  type ArtifactRect,
  artifactCommentState,
  DESIGN_LIMITS,
  type DesignCommentRecord,
  describeAnchor,
  type DesignTarget as ElementTarget,
} from '@cairn/shared';
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { useDesignComments, useDesignMutations } from '../../api/hooks.js';
import { Button } from '../../components/ui/button.js';
import { Textarea } from '../../components/ui/textarea.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import {
  type CommentActions,
  CommentList,
  CommentPin,
  type CommentSend,
} from '../design/design-comment-list.js';
import { useArtifactEscape, useArtifactPanelControl } from './artifact-panel.js';
import { CommentStrip } from './comment-strip.js';
import type { SendDesignComments } from './page-artifact.js';

const COMPOSER_W = 300;
const COMPOSER_H = 168;
const GAP = 8;
const POINT_PX = 4;

export const COMMENT_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'document',
  'design',
  'diagram',
  'whiteboard',
  'code',
  'sheet',
  'pdf',
  'docx',
  'image',
  'video',
]);

export interface AnchorPick {
  anchor: ArtifactAnchor | null;
  element?: Pick<ElementTarget, 'selector' | 'label' | 'text'>;
  point: { x: number; y: number };
  rect?: { page: number | undefined; rect: ArtifactRect };
}

export interface Extent {
  pages?: number;
  lines?: number;
  rows?: number;
  cols?: number;
  lostElements?: ReadonlySet<string>;
  textIn?: (page: number | undefined, rect: ArtifactRect) => string;
  findText?: (text: string) => { page: number; rect: ArtifactRect } | null;
}

function relocate(
  comment: DesignCommentRecord,
  versionId: string | undefined,
  extent: Extent,
): DesignCommentRecord | null {
  const anchor = comment.anchor;
  if (anchor?.type !== 'region' || comment.text === '' || comment.versionId === versionId)
    return comment;
  if (extent.findText === undefined) return comment;
  const hit = extent.findText(comment.text);
  return hit === null
    ? null
    : { ...comment, anchor: { ...anchor, page: hit.page, rect: hit.rect } };
}

interface CommentLayer {
  commenting: boolean;
  comments: readonly DesignCommentRecord[];
  draftRect: { page: number | undefined; rect: ArtifactRect } | null;
  pick: (pick: AnchorPick) => void;
  focus: (id: string) => void;
  report: (extent: Extent) => void;
}

const CommentLayerContext = createContext<CommentLayer | null>(null);

export function useCommentLayer(): CommentLayer | null {
  return useContext(CommentLayerContext);
}

function resolves(anchor: ArtifactAnchor | null, id: string, extent: Extent): boolean {
  if (extent.lostElements?.has(id)) return false;
  if (anchor === null) return true;
  switch (anchor.type) {
    case 'region':
      return anchor.page === undefined || extent.pages === undefined || anchor.page <= extent.pages;
    case 'lines':
      return extent.lines === undefined || anchor.to <= extent.lines;
    case 'cells':
      return (
        extent.rows === undefined ||
        extent.cols === undefined ||
        (anchor.r2 < extent.rows && anchor.c2 < extent.cols)
      );
    default:
      return true;
  }
}

function emptyTarget(label: string): ElementTarget {
  return {
    elementId: '',
    selector: '',
    label: label.slice(0, DESIGN_LIMITS.labelChars),
    text: '',
    htmlHint: '',
    position: { x: 0, y: 0, width: 0, height: 0 },
    style: null,
  };
}

export function useFileComments({
  todoId,
  fileName,
  versionId,
  enabled,
  readOnly,
  sendComments,
  onLocate,
}: {
  todoId: string;
  fileName: string;
  versionId: string | undefined;
  enabled: boolean;
  readOnly: boolean;
  sendComments: SendDesignComments | undefined;
  onLocate?: (comment: DesignCommentRecord) => void;
}) {
  const { t } = useI18n();
  const commentsQ = useDesignComments(todoId, fileName, enabled);
  const data = commentsQ.data;
  const comments = useMemo(() => data ?? [], [data]);
  const active = useMemo(
    () => comments.filter((comment) => comment.status !== 'resolved'),
    [comments],
  );
  const { createComment, patchComment, deleteComment } = useDesignMutations(todoId, fileName);
  const [commenting, setCommenting] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [draft, setDraft] = useState<AnchorPick | null>(null);
  const [retargetId, setRetargetId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [extent, setExtent] = useState<Extent>({});
  const canComment = enabled && !readOnly && versionId !== undefined;
  const failed = (message: string) => (error: unknown) => toastError(t(message), error);
  const { active: panelActive } = useArtifactPanelControl();
  const stop = useCallback(() => {
    setCommenting(false);
    setDraft(null);
    setRetargetId(null);
  }, []);
  const handleEscape = useCallback(() => {
    if (commenting) {
      stop();
      return;
    }
    if (!document.querySelector('[data-testid="artifact-history"]')?.checkVisibility()) {
      setListOpen(false);
    }
  }, [commenting, stop]);
  useArtifactEscape(panelActive && draft === null && (commenting || listOpen), handleEscape);
  const targetOf = (pick: AnchorPick): ElementTarget =>
    pick.element !== undefined
      ? { ...emptyTarget(pick.element.label), ...pick.element }
      : emptyTarget(pick.anchor === null ? '' : describeAnchor(pick.anchor));
  const pick = (picked: AnchorPick) => {
    if (!canComment || versionId === undefined) return;
    const next = withText(picked);
    if (retargetId !== null) {
      const id = retargetId;
      setRetargetId(null);
      setCommenting(false);
      patchComment.mutate(
        {
          id,
          patch: {
            retarget: { ...targetOf(next), versionId, viewport: 'desktop', anchor: next.anchor },
          },
        },
        { onError: failed('评论未能修改') },
      );
      return;
    }
    setDraft(next);
  };
  const withText = (next: AnchorPick): AnchorPick =>
    next.anchor?.type === 'region' && next.element === undefined && extent.textIn !== undefined
      ? {
          ...next,
          element: {
            selector: '',
            label: describeAnchor(next.anchor),
            text: extent.textIn(next.anchor.page, next.anchor.rect).slice(0, 200),
          },
        }
      : next;
  const save = (note: string) => {
    if (draft === null || versionId === undefined) return;
    createComment.mutate(
      { ...targetOf(draft), versionId, viewport: 'desktop', anchor: draft.anchor, note },
      {
        onSuccess: () => {
          setDraft(null);
          setListOpen(true);
        },
        onError: failed('评论未能保存'),
      },
    );
  };
  const actions: CommentActions = {
    edit: (id, note, onError) =>
      patchComment.mutate(
        { id, patch: { note } },
        {
          onError: (error) => {
            failed('评论未能修改')(error);
            onError?.();
          },
        },
      ),
    remove: (id) => deleteComment.mutate(id, { onError: failed('评论未能删除') }),
    resolve: (id) =>
      patchComment.mutate(
        { id, patch: { status: 'resolved' } },
        { onError: failed('评论未能修改') },
      ),
    reopen: (id) =>
      patchComment.mutate({ id, patch: { status: 'open' } }, { onError: failed('评论未能修改') }),
    retarget: (id) => {
      setRetargetId(id);
      setDraft(null);
      setCommenting(true);
    },
  };
  const send: CommentSend | undefined =
    sendComments === undefined
      ? undefined
      : {
          busy: sending,
          run: (ids) => {
            setSending(true);
            void sendComments(ids).finally(() => setSending(false));
          },
        };
  const report = useCallback(
    (next: Extent) => setExtent((current) => ({ ...current, ...next })),
    [],
  );
  const placed = useMemo(() => {
    const lost = new Set<string>();
    const shown: DesignCommentRecord[] = [];
    for (const comment of active) {
      const moved = relocate(comment, versionId, extent);
      if (moved === null) lost.add(comment.id);
      else shown.push(moved);
    }
    return { shown, lost, byId: new Map(shown.map((comment) => [comment.id, comment])) };
  }, [active, versionId, extent]);
  const resolved = useMemo<Extent>(
    () => ({
      ...extent,
      lostElements: new Set([...(extent.lostElements ?? []), ...placed.lost]),
    }),
    [extent, placed],
  );
  const focus = useCallback((id: string) => {
    setFocusedId(id);
    setListOpen(true);
  }, []);
  const layer: CommentLayer = {
    commenting: commenting && canComment,
    comments: placed.shown,
    draftRect: draft?.rect ?? null,
    pick,
    focus,
    report,
  };
  const on = commenting || listOpen;
  return {
    layer,
    toolbar: enabled
      ? {
          count: active.length,
          on,
          disabled: false,
          toggle: () => {
            setCommenting(!on && canComment);
            setListOpen(!on);
            setDraft(null);
            setRetargetId(null);
          },
        }
      : null,
    strip:
      commenting && canComment
        ? ({ hint, tool }: { hint: string; tool?: Parameters<typeof CommentStrip>[0]['tool'] }) => (
            <CommentStrip
              hint={retargetId !== null ? t('点一个新位置，把这条批注指过去') : hint}
              {...(tool !== undefined ? { tool } : {})}
              onExit={stop}
            />
          )
        : null,
    list: listOpen ? (
      <CommentList
        comments={comments}
        stateOf={(comment) =>
          artifactCommentState({
            status: comment.status,
            handledSeq: comment.handledSeq,
            anchorResolves: resolves(
              (placed.byId.get(comment.id) ?? comment).anchor,
              comment.id,
              resolved,
            ),
          })
        }
        readOnly={readOnly || !enabled}
        focusedId={focusedId}
        actions={actions}
        send={send}
        onPick={(comment) => {
          setFocusedId(comment.id);
          onLocate?.(comment);
        }}
        onClose={() => {
          setListOpen(false);
          stop();
        }}
      />
    ) : null,
    composer:
      draft === null
        ? null
        : (container: HTMLElement | null) => (
            <AnchorComposer
              key={`${draft.point.x}:${draft.point.y}`}
              caption={targetOf(draft).label}
              point={draft.point}
              container={container}
              busy={createComment.isPending}
              onCancel={() => setDraft(null)}
              onSave={save}
            />
          ),
  };
}

export function CommentLayerProvider({
  layer,
  children,
}: {
  layer: CommentLayer | null;
  children: ReactNode;
}) {
  return <CommentLayerContext.Provider value={layer}>{children}</CommentLayerContext.Provider>;
}

function AnchorComposer({
  caption,
  point,
  container,
  busy,
  onCancel,
  onSave,
}: {
  caption: string;
  point: { x: number; y: number };
  container: HTMLElement | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (note: string) => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const box = container?.getBoundingClientRect();
  const width = box?.width ?? COMPOSER_W;
  const height = box?.height ?? COMPOSER_H;
  const x = point.x - (box?.left ?? 0);
  const y = point.y - (box?.top ?? 0);
  const left = Math.max(GAP, Math.min(x + GAP, width - COMPOSER_W - GAP));
  const top = y + GAP + COMPOSER_H <= height ? y + GAP : Math.max(GAP, y - COMPOSER_H - GAP);
  const trimmed = note.trim();
  return (
    <form
      aria-label={t('写批注')}
      data-testid="artifact-comment-composer"
      className="absolute z-(--z-floating) flex flex-col gap-2.5 rounded-(--radius-popover) border border-border bg-popover p-3 text-popover-foreground shadow-(--shadow-popover)"
      style={{ left, top, width: Math.min(COMPOSER_W, width - GAP * 2) }}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed !== '' && !busy) onSave(trimmed);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && trimmed !== '') {
          event.preventDefault();
          onSave(trimmed);
        }
      }}
    >
      <p className="m-0 truncate text-meta text-content-secondary">{caption}</p>
      <Textarea
        data-testid="artifact-comment-note"
        aria-label={t('评论内容')}
        placeholder={t('这里要怎么改')}
        maxLength={DESIGN_LIMITS.noteChars}
        value={note}
        autoFocus
        onChange={(event) => setNote(event.target.value)}
        className="min-h-16 resize-none text-ui"
      />
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-meta text-content-tertiary">
          {t('攒几条再一起发')}
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('取消')}
        </Button>
        <Button
          type="submit"
          size="sm"
          data-testid="artifact-comment-save"
          disabled={trimmed === '' || busy}
        >
          {t('保存')}
        </Button>
      </div>
    </form>
  );
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): string {
  return `${value * 100}%`;
}

export function RegionSurface({ page }: { page?: number }) {
  const { t } = useI18n();
  const layer = useCommentLayer();
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<ArtifactRect | null>(null);
  if (layer === null) return null;
  const pins = layer.comments.flatMap((comment) =>
    comment.anchor?.type === 'region' && comment.anchor.page === page
      ? [{ comment, rect: comment.anchor.rect }]
      : [],
  );
  const relative = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / Math.max(1, box.width)),
      y: clamp((event.clientY - box.top) / Math.max(1, box.height)),
      box,
    };
  };
  const draftRect =
    rect ??
    (layer.draftRect !== null && layer.draftRect.page === page ? layer.draftRect.rect : null);
  return (
    <div
      role="application"
      aria-label={t('按住拖出要批注的区域，或点击一处')}
      data-testid="artifact-region-layer"
      data-page={page}
      className={`absolute inset-0 ${layer.commenting ? 'pointer-events-auto cursor-crosshair touch-none' : 'pointer-events-none'}`}
      onPointerDown={(event) => {
        if (!layer.commenting || event.button !== 0) return;
        if ((event.target as HTMLElement).closest('[data-testid="design-pin"]') !== null) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = relative(event);
        setStart({ x: at.x, y: at.y });
        setRect({ x: at.x, y: at.y, width: 0, height: 0 });
      }}
      onPointerMove={(event) => {
        if (start === null) return;
        const at = relative(event);
        setRect({
          x: Math.min(start.x, at.x),
          y: Math.min(start.y, at.y),
          width: Math.abs(at.x - start.x),
          height: Math.abs(at.y - start.y),
        });
      }}
      onPointerUp={(event) => {
        if (start === null || rect === null) return;
        const at = relative(event);
        const tiny = rect.width * at.box.width < POINT_PX && rect.height * at.box.height < POINT_PX;
        const final = tiny ? { x: start.x, y: start.y, width: 0, height: 0 } : rect;
        setStart(null);
        setRect(null);
        layer.pick({
          anchor: { type: 'region', ...(page !== undefined ? { page } : {}), rect: final },
          point: { x: event.clientX, y: event.clientY },
          rect: { page, rect: final },
        });
      }}
    >
      {draftRect !== null && (
        <div
          data-testid="artifact-region-draft"
          className="absolute rounded-xs border border-dashed border-(--focus-ring) bg-(--focus-ring)/10"
          style={{
            left: percent(draftRect.x),
            top: percent(draftRect.y),
            width: percent(draftRect.width),
            height: percent(draftRect.height),
          }}
        />
      )}
      {pins.map(({ comment, rect: at }) => (
        <div key={comment.id}>
          {at.width > 0 && (
            <div
              className="absolute rounded-xs border border-dashed border-content-tertiary"
              style={{
                left: percent(at.x),
                top: percent(at.y),
                width: percent(at.width),
                height: percent(at.height),
              }}
            />
          )}
          <div className="absolute" style={{ left: percent(at.x + at.width), top: percent(at.y) }}>
            <CommentPin
              pin={comment.pin}
              status={comment.status}
              onClick={() => layer.focus(comment.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
