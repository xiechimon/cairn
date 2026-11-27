import { type DesignViewport, designPagePath } from '@cairn/shared';
import { Check, Code, Copy, Download, FileWarning, Globe, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useDesignComments, useDesignMutations, useDesignPageHtml } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { CopyIconButton } from '../../components/copy-icon-button.js';
import { EmptyState } from '../../components/empty-state.js';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { KeyedMenuItem, KeyedMenuRadioItem } from '../../components/menu-keys.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { TextViewer } from '../../vendor-open-design/viewers/text-viewer.js';
import {
  type CommentDraftHandlers,
  DesignCanvas,
  type MarkHandlers,
  type MarkInput,
} from '../design/design-canvas.js';
import type { CommentActions } from '../design/design-comment-list.js';
import { ExportMenu } from '../design/design-export.js';
import { bakeMarkPng, MarkError, markTarget } from '../design/design-markup.js';
import { SharePopover } from '../design/design-share.js';
import { designSrcdoc } from '../design/srcdoc.js';
import { deliverableHref } from '../made-files.js';
import { useArtifactEscape, useArtifactPanelControl } from './artifact-panel.js';
import {
  ArtifactToolbar,
  OldVersionBar,
  TOOL_BUTTON,
  VersionHistory,
  versionLabel,
} from './artifact-toolbar.js';
import { CommentStrip } from './comment-strip.js';
import { deckSrcdoc, isSlideDeck, SLIDE_SIZE, useSlideDeck } from './slide-deck.js';
import { useArtifactVersions } from './use-artifact-versions.js';
import { DECK_KEYS, DeckPager, useFullscreen } from './viewers/deck-pager.js';
import { useZoomShortcuts, type Zoom, ZoomControl } from './viewers/zoom.js';

const VIEWPORT_LABEL: Record<DesignViewport, string> = {
  desktop: '桌面',
  tablet: '平板',
  mobile: '手机',
};

export type SendDesignComments = (ids: readonly string[]) => Promise<void>;

export function PageArtifact({
  todoId,
  fileName,
  openedVersionId,
  readOnly,
  sendComments,
}: {
  todoId: string;
  fileName: string;
  openedVersionId: string | null;
  readOnly: boolean;
  sendComments: SendDesignComments | undefined;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const versions = useArtifactVersions(todoId, fileName, openedVersionId);
  const { page, shown, viewingOld } = versions;
  const { active: panelActive, closePanel } = useArtifactPanelControl();
  const [viewport, setViewport] = useState<DesignViewport>('desktop');
  const [source, setSource] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [reloads, setReloads] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const htmlQ = useDesignPageHtml(shown?.id ?? null);
  const missing =
    htmlQ.error instanceof ApiError && (htmlQ.error.status === 404 || htmlQ.error.status === 410);
  const emptyHtml = htmlQ.data !== undefined && htmlQ.data.trim() === '';
  const deckLike = useMemo(() => htmlQ.data !== undefined && isSlideDeck(htmlQ.data), [htmlQ.data]);
  const srcdoc = useMemo(
    () =>
      htmlQ.data === undefined
        ? null
        : deckLike
          ? deckSrcdoc(htmlQ.data)
          : designSrcdoc(htmlQ.data),
    [htmlQ.data, deckLike],
  );
  useZoomShortcuts({
    active:
      panelActive &&
      !source &&
      page !== undefined &&
      shown !== undefined &&
      !missing &&
      !htmlQ.isError &&
      !emptyHtml &&
      srcdoc !== null,
    scale: zoom === 'fit' ? fitScale : zoom,
    onChange: setZoom,
  });
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const slides = useSlideDeck(frameRef, `${shown?.id ?? ''}:${reloads}`);
  const { slide, step: stepSlide } = slides;
  const deck = deckLike && slides.count !== 0;
  const [deckShell, setDeckShell] = useState<HTMLDivElement | null>(null);
  const presenting = useFullscreen(deckShell);
  useEffect(() => {
    if (!deck || deckShell === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const step = DECK_KEYS[event.key];
      if (step === undefined || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select') !== null)
      )
        return;
      event.preventDefault();
      stepSlide(step);
    };
    deckShell.addEventListener('keydown', onKeyDown);
    return () => deckShell.removeEventListener('keydown', onKeyDown);
  }, [deck, deckShell, stepSlide]);
  const frameViewport: DesignViewport = deck ? 'desktop' : viewport;
  const slideAnchor =
    deck && slides.shown !== null ? { type: 'slide' as const, slide: slides.shown + 1 } : null;
  const { createComment, patchComment, deleteComment, saveMark, createShare, stopShare } =
    useDesignMutations(todoId, fileName);
  const [commenting, setCommenting] = useState(false);
  const [retargetId, setRetargetId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const stopCommenting = useCallback(() => {
    setCommenting(false);
    setRetargetId(null);
  }, []);
  const [marking, setMarking] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const stopMarking = useCallback(() => setMarking(false), []);
  useEffect(() => {
    if (!viewingOld) return;
    setCommenting(false);
    setMarking(false);
    setRetargetId(null);
  }, [viewingOld]);
  useEffect(() => {
    if (!presenting) return;
    setCommenting(false);
    setMarking(false);
    setRetargetId(null);
    setListOpen(false);
  }, [presenting]);
  const handleOverlayEscape = useCallback(() => {
    if (historyOpen) setHistoryOpen(false);
    else setListOpen(false);
  }, [historyOpen]);
  useArtifactEscape(
    panelActive && !commenting && !marking && (historyOpen || listOpen),
    handleOverlayEscape,
  );
  const commentsQ = useDesignComments(todoId, fileName, live);
  const comments = commentsQ.data ?? [];
  const activeComments = comments.filter((comment) => comment.status !== 'resolved').length;
  const canComment = !readOnly && live && !viewingOld && !source && !missing && !emptyHtml;
  const commentFailed = (message: string) => (error: unknown) => toastError(t(message), error);
  const actions: CommentActions = {
    edit: (id, note, onError) =>
      patchComment.mutate(
        { id, patch: { note } },
        {
          onError: (error) => {
            commentFailed('评论未能修改')(error);
            onError?.();
          },
        },
      ),
    remove: (id) => deleteComment.mutate(id, { onError: commentFailed('评论未能删除') }),
    resolve: (id) =>
      patchComment.mutate(
        { id, patch: { status: 'resolved' } },
        { onError: commentFailed('评论未能修改') },
      ),
    reopen: (id) =>
      patchComment.mutate(
        { id, patch: { status: 'open' } },
        { onError: commentFailed('评论未能修改') },
      ),
    retarget: (id) => {
      setRetargetId(id);
      setMarking(false);
      setCommenting(true);
    },
  };
  const send =
    sendComments === undefined
      ? undefined
      : {
          busy: sending,
          run: (ids: readonly string[]) => {
            setSending(true);
            void sendComments(ids).finally(() => setSending(false));
          },
        };
  if (page === undefined || shown === undefined) {
    return versions.pagesFailed ? (
      <EmptyState
        testId="design-error"
        icon={FileWarning}
        title={t('网页未能加载')}
        description={t('请检查网络后重试。')}
        action={{ label: t('重试'), onClick: versions.retryPages }}
        className="mt-[12vh]"
      />
    ) : versions.pagesPending ? (
      <Skeleton
        data-testid="design-loading"
        className="m-6 min-h-0 flex-1 rounded-(--radius-tile)"
      />
    ) : (
      <EmptyState
        testId="design-missing"
        icon={FileWarning}
        title={t('这一版的文件已不存在')}
        className="mt-[12vh]"
      />
    );
  }
  const createFrom = (
    target: Parameters<CommentDraftHandlers['save']>[0],
    note: string,
    then: (id: string) => void,
  ) =>
    createComment.mutate(
      {
        ...target,
        versionId: shown.id,
        viewport: frameViewport,
        note,
        ...(slideAnchor !== null ? { anchor: slideAnchor } : {}),
      },
      { onSuccess: (row) => then(row.id), onError: commentFailed('评论未能保存') },
    );
  const retarget =
    retargetId === null
      ? undefined
      : (target: Parameters<CommentDraftHandlers['save']>[0]) => {
          setRetargetId(null);
          setCommenting(false);
          patchComment.mutate(
            {
              id: retargetId,
              patch: {
                retarget: {
                  ...target,
                  versionId: shown.id,
                  viewport: frameViewport,
                  anchor: slideAnchor,
                },
              },
            },
            { onError: commentFailed('评论未能修改') },
          );
        };
  const draft: CommentDraftHandlers = {
    busy: createComment.isPending,
    save: (target, note, done) => createFrom(target, note, () => done()),
    send:
      sendComments === undefined
        ? undefined
        : (target, note, done) =>
            createFrom(target, note, (id) => {
              done();
              void sendComments([id]);
            }),
  };
  const markFrom = async ({ frame, marks, note }: MarkInput, then: (id: string) => void) => {
    setMarkBusy(true);
    try {
      const pngBase64 = await bakeMarkPng(frame, marks, frame.offsetWidth);
      const { attachmentId } = await saveMark.mutateAsync(pngBase64);
      const row = await createComment.mutateAsync({
        ...markTarget(marks, { width: frame.offsetWidth, height: frame.offsetHeight }, t('标注')),
        versionId: shown.id,
        viewport,
        note,
        markAttachmentId: attachmentId,
      });
      then(row.id);
    } catch (error) {
      toastError(
        error instanceof MarkError
          ? error.reason === 'snapshot'
            ? t('页面截图未能截取，标注未保存')
            : t('标注图超过 5 MB，未保存')
          : t('标注未能保存'),
        error,
      );
    } finally {
      setMarkBusy(false);
    }
  };
  const mark: MarkHandlers = {
    busy: markBusy,
    save: (input, done) => void markFrom(input, () => done()),
    send:
      sendComments === undefined
        ? undefined
        : (input, done) =>
            void markFrom(input, (id) => {
              done();
              void sendComments([id]);
            }),
  };
  const pageHref = designPagePath(shown.id);
  const commentOn = (commenting || marking) && canComment;
  return (
    <>
      <ArtifactToolbar
        name={fileName}
        menu={
          <>
            <KeyedMenuItem
              shortcut="B"
              data-testid="design-open-browser"
              disabled={missing}
              render={<a href={pageHref} target="_blank" rel="noopener noreferrer" />}
            >
              <Globe aria-hidden />
              {t('在浏览器打开')}
            </KeyedMenuItem>
            <KeyedMenuItem
              shortcut="D"
              data-testid="design-download"
              disabled={missing}
              render={<a href={deliverableHref(shown.attachmentId)} download={fileName} />}
            >
              <Download aria-hidden />
              {t('下载')}
            </KeyedMenuItem>
            <KeyedMenuItem shortcut="R" onClick={() => setReloads((n) => n + 1)}>
              <RotateCw aria-hidden />
              {t('重新加载')}
            </KeyedMenuItem>
            {!deck && <DropdownMenuSeparator />}
            {!deck && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('视口')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={viewport}
                  onValueChange={(next) => {
                    setViewport(next as DesignViewport);
                    setZoom('fit');
                  }}
                >
                  {(['desktop', 'tablet', 'mobile'] as const).map((value) => (
                    <KeyedMenuRadioItem
                      key={value}
                      value={value}
                      data-testid={`design-viewport-menu-${value}`}
                    >
                      {t(VIEWPORT_LABEL[value])}
                    </KeyedMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            )}
          </>
        }
        controls={
          <>
            {!source && <ZoomControl zoom={zoom} fitScale={fitScale} onChange={setZoom} />}
            {!deck && (
              <SegmentedTabs
                value={viewport}
                label={t('视口')}
                className="max-[640px]:hidden"
                onChange={(next) => {
                  setViewport(next);
                  setZoom('fit');
                }}
                options={(['desktop', 'tablet', 'mobile'] as const).map((value) => ({
                  value,
                  label: t(VIEWPORT_LABEL[value]),
                  testId: `design-viewport-${value}`,
                }))}
              />
            )}
            {source && htmlQ.data !== undefined && (
              <CopyIconButton
                text={htmlQ.data}
                label={t('复制')}
                copiedLabel={t('已复制')}
                side="bottom"
                size="icon-sm"
                testId="artifact-copy"
                replaceClassName
                className={`${TOOL_BUTTON} w-7 px-0`}
                icons={{
                  copy: <Copy aria-hidden className="size-4" />,
                  copied: <Check aria-hidden className="size-4" />,
                }}
              />
            )}
            <IconTooltip
              label={source ? t('看预览') : t('看源码')}
              side="bottom"
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="design-source-toggle"
                  aria-pressed={source}
                  className={`${TOOL_BUTTON} w-7 px-0`}
                  onClick={() =>
                    setSource((v) => {
                      if (!v) {
                        setCommenting(false);
                        setMarking(false);
                        setRetargetId(null);
                      }
                      return !v;
                    })
                  }
                />
              }
            >
              <Code aria-hidden className="size-4" />
            </IconTooltip>
          </>
        }
        comments={
          live
            ? {
                count: activeComments,
                on: commentOn || listOpen,
                disabled: source,
                toggle: () => {
                  const next = !(commentOn || listOpen);
                  setMarking(false);
                  setRetargetId(null);
                  setCommenting(next && canComment);
                  setListOpen(next);
                },
              }
            : null
        }
        history={{ open: historyOpen, toggle: () => setHistoryOpen((open) => !open) }}
        exportMenu={
          <>
            <ExportMenu
              fileName={fileName}
              html={htmlQ.data}
              frameRef={frameRef}
              previewing={!source && srcdoc !== null && !emptyHtml}
              printHref={`${pageHref}?print=1`}
            />
            {live && (
              <SharePopover
                fileName={fileName}
                html={htmlQ.data}
                shareOrigin={versions.shareOrigin}
                shareToken={page.shareToken}
                readOnly={readOnly}
                control={{
                  busy: createShare.isPending || stopShare.isPending,
                  create: (onError) => createShare.mutate(undefined, { onError }),
                  stop: (onError) => stopShare.mutate(undefined, { onError }),
                }}
              />
            )}
          </>
        }
      />
      {viewingOld && (
        <OldVersionBar
          shown={shown}
          current={page.current}
          readOnly={readOnly}
          restoring={versions.restoring}
          onRestore={versions.restoreShown}
          onCurrent={versions.showCurrent}
        />
      )}
      {commentOn && (
        <CommentStrip
          hint={
            retargetId !== null
              ? t('点一个元素，把这条批注指到新位置')
              : marking
                ? t('在页面上画出要改的地方，写一句说明')
                : t('点一个元素加批注')
          }
          {...(deck
            ? {}
            : {
                tool: {
                  label: marking ? t('点选元素') : t('画标注'),
                  testId: 'design-mark-mode',
                  onClick: () => {
                    setCommenting(marking);
                    setMarking(!marking);
                  },
                },
              })}
          onExit={() => {
            setRetargetId(null);
            setCommenting(false);
            setMarking(false);
          }}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {missing ? (
            <EmptyState
              testId="design-missing"
              icon={FileWarning}
              title={t('这一版的文件已不存在')}
              className="mt-[12vh]"
            />
          ) : htmlQ.isError ? (
            <EmptyState
              testId="design-error"
              icon={FileWarning}
              title={t('网页未能加载')}
              description={t('请检查网络后重试。')}
              action={{ label: t('重试'), onClick: () => void htmlQ.refetch() }}
              className="mt-[12vh]"
            />
          ) : srcdoc === null || htmlQ.data === undefined ? (
            <Skeleton
              data-testid="design-loading"
              className="m-6 min-h-0 flex-1 rounded-(--radius-tile)"
            />
          ) : source ? (
            <div data-testid="design-source" className="min-h-0 flex-1 overflow-auto">
              <TextViewer name={fileName} text={htmlQ.data} />
            </div>
          ) : emptyHtml ? (
            <EmptyState
              testId="design-empty"
              icon={FileWarning}
              title={t('这个网页文件是空的')}
              className="mt-[12vh]"
            />
          ) : (
            <div
              ref={setDeckShell}
              tabIndex={-1}
              data-testid={deck ? 'artifact-slides' : undefined}
              data-current={deck && slides.shown !== null ? slides.shown + 1 : undefined}
              className="flex min-h-0 flex-1 flex-col bg-(--surface-1) outline-none"
            >
              <DesignCanvas
                key={`${shown.id}:${reloads}`}
                frameRef={frameRef}
                srcdoc={srcdoc}
                title={`${fileName} · ${versionLabel(shown, t)}`}
                viewport={frameViewport}
                size={deck ? SLIDE_SIZE : undefined}
                slide={deck ? (slides.shown ?? -1) + 1 : undefined}
                onPickComment={
                  deck
                    ? (comment) => {
                        if (comment.anchor?.type === 'slide') slides.go(comment.anchor.slide - 1);
                      }
                    : undefined
                }
                floating={
                  deck && slides.count !== null ? (
                    <DeckPager
                      current={slides.shown ?? slide}
                      count={slides.count}
                      presenting={presenting}
                      shell={deckShell}
                      onGo={slides.go}
                    />
                  ) : undefined
                }
                zoom={zoom}
                fitScale={fitScale}
                onFitScale={setFitScale}
                onZoomChange={setZoom}
                onEscape={() => {
                  if (document.fullscreenElement !== null) return;
                  if (historyOpen) setHistoryOpen(false);
                  else if (listOpen) setListOpen(false);
                  else closePanel();
                }}
                commenting={commenting && canComment}
                onStopCommenting={stopCommenting}
                marking={marking && canComment}
                onStopMarking={stopMarking}
                mark={mark}
                comments={comments}
                listOpen={listOpen}
                onListOpen={setListOpen}
                readOnly={readOnly}
                actions={actions}
                draft={draft}
                send={send}
                retarget={retarget}
              />
            </div>
          )}
        </div>
        {historyOpen && (
          <VersionHistory
            versions={versions.versions}
            currentId={page.current.id}
            shownId={shown.id}
            onPick={versions.pick}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>
    </>
  );
}
