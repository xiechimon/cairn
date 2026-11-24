import { type DesignViewport, designPagePath } from '@cairn/shared';
import { Code, FileWarning, Globe, RotateCw } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useDesignComments, useDesignMutations, useDesignPageHtml } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { EmptyState } from '../../components/empty-state.js';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { KeyedMenuItem } from '../../components/menu-keys.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { Download } from '../../icons/index.js';
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
import {
  ArtifactToolbar,
  OldVersionBar,
  TOOL_BUTTON,
  VersionHistory,
  versionLabel,
} from './artifact-toolbar.js';
import { CommentStrip } from './comment-strip.js';
import { useArtifactVersions } from './use-artifact-versions.js';

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
  const [viewport, setViewport] = useState<DesignViewport>('desktop');
  const [source, setSource] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const htmlQ = useDesignPageHtml(shown?.id ?? null);
  const srcdoc = useMemo(
    () => (htmlQ.data === undefined ? null : designSrcdoc(htmlQ.data)),
    [htmlQ.data],
  );
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { createComment, patchComment, deleteComment, saveMark, createShare, stopShare } =
    useDesignMutations(todoId, fileName);
  const [commenting, setCommenting] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const stopCommenting = useCallback(() => setCommenting(false), []);
  const [marking, setMarking] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const stopMarking = useCallback(() => setMarking(false), []);
  const commentsQ = useDesignComments(todoId, fileName, live);
  const comments = commentsQ.data ?? [];
  const activeComments = comments.filter((comment) => comment.status !== 'resolved').length;
  const canComment = !readOnly && live && !viewingOld && !source;
  const commentFailed = (message: string) => (error: unknown) => toastError(t(message), error);
  const actions: CommentActions = {
    edit: (id, note) =>
      patchComment.mutate({ id, patch: { note } }, { onError: commentFailed('评论未能修改') }),
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
    ) : (
      <Skeleton
        data-testid="design-loading"
        className="m-6 min-h-0 flex-1 rounded-(--radius-tile)"
      />
    );
  }
  const createFrom = (
    target: Parameters<CommentDraftHandlers['save']>[0],
    note: string,
    then: (id: string) => void,
  ) =>
    createComment.mutate(
      { ...target, versionId: shown.id, viewport, note },
      { onSuccess: (row) => then(row.id), onError: commentFailed('评论未能保存') },
    );
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
  const missing = htmlQ.error instanceof ApiError && htmlQ.error.status === 404;
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
              render={<a href={pageHref} target="_blank" rel="noopener noreferrer" />}
            >
              <Globe aria-hidden />
              {t('在浏览器打开')}
            </KeyedMenuItem>
            <KeyedMenuItem
              shortcut="D"
              data-testid="design-download"
              render={<a href={deliverableHref(shown.attachmentId)} download={fileName} />}
            >
              <Download aria-hidden />
              {t('下载')}
            </KeyedMenuItem>
            <KeyedMenuItem shortcut="R" onClick={() => setReloads((n) => n + 1)}>
              <RotateCw aria-hidden />
              {t('重新加载')}
            </KeyedMenuItem>
          </>
        }
        controls={
          <>
            <SegmentedTabs
              value={viewport}
              label={t('视口')}
              className="max-[640px]:hidden"
              onChange={setViewport}
              options={(['desktop', 'tablet', 'mobile'] as const).map((value) => ({
                value,
                label: t(VIEWPORT_LABEL[value]),
                testId: `design-viewport-${value}`,
              }))}
            />
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
                  onClick={() => setSource((v) => !v)}
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
              previewing={!source && srcdoc !== null}
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
          hint={marking ? t('在页面上画出要改的地方，写一句说明') : t('点一个元素加批注')}
          tool={{
            label: marking ? t('点选元素') : t('画标注'),
            testId: 'design-mark-mode',
            onClick: () => {
              setCommenting(marking);
              setMarking(!marking);
            },
          }}
          onExit={() => {
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
          ) : (
            <DesignCanvas
              key={`${shown.id}:${reloads}`}
              frameRef={frameRef}
              srcdoc={srcdoc}
              title={`${fileName} · ${versionLabel(shown, t)}`}
              viewport={viewport}
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
            />
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
