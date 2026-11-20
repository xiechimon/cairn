import {
  type DesignPageRecord,
  type DesignVersionRecord,
  type DesignViewport,
  designPagePath,
} from '@cairn/shared';
import { Code, Ellipsis, FileWarning, Globe, RotateCw } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../../api/client.js';
import {
  useDesignComments,
  useDesignMutations,
  useDesignPageHtml,
  useDesignPages,
  useDesignVersions,
  useTodo,
} from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { EmptyState } from '../../components/empty-state.js';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { ChevronDown, Download, X } from '../../icons/index.js';
import { TextViewer } from '../../vendor-open-design/viewers/text-viewer.js';
import { FILE_PARAM } from '../file-pane.js';
import { deliverableHref } from '../made-files.js';
import { type CommentDraftHandlers, DesignCanvas } from './design-canvas.js';
import type { CommentActions } from './design-comment-list.js';
import { type DesignTarget, pickPage } from './design-route.js';
import { VersionsMenu, versionLabel } from './design-versions.js';
import { designSrcdoc } from './srcdoc.js';

const HEAD_ICON = 'text-content-secondary hover:text-foreground';

const VIEWPORT_LABEL: Record<DesignViewport, string> = {
  desktop: '桌面',
  tablet: '平板',
  mobile: '手机',
};

export type SendDesignComments = (ids: readonly string[]) => Promise<void>;

export function DesignPane({
  target,
  switcher,
  hidden,
  onClose,
  sendComments,
}: {
  target: DesignTarget;
  switcher: ReactNode;
  hidden: boolean;
  onClose: () => void;
  sendComments: SendDesignComments | undefined;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const pagesQ = useDesignPages(target.todoId, live);
  const todoQ = useTodo(target.todoId, live);
  const pages = pagesQ.data?.pages ?? [];
  const page = pickPage(pages, target.fileName);
  const head = (
    <div
      data-testid="design-head"
      className="flex h-12 flex-none items-center gap-2 border-b border-border px-3"
    >
      {switcher}
      <h2 className="m-0 min-w-0 flex-1 truncate text-ui font-medium text-foreground">
        {todoQ.data?.title ?? page?.fileName ?? t('设计')}
      </h2>
      <Button
        variant="ghost"
        size="icon-sm"
        data-testid="design-close"
        aria-label={t('关闭设计视图')}
        onClick={onClose}
        className={`${HEAD_ICON} pointer-coarse:size-11`}
      >
        <X aria-hidden className="size-5.5" />
      </Button>
    </div>
  );
  const body = pagesQ.isPending ? (
    live ? (
      <DesignLoading />
    ) : (
      <EmptyState
        testId="design-empty"
        icon={Globe}
        title={t('这个任务还没有网页')}
        className="mt-[12vh]"
      />
    )
  ) : pagesQ.isError ? (
    <EmptyState
      testId="design-error"
      icon={FileWarning}
      title={t('网页没加载出来')}
      description={t('检查网络后再试一次。')}
      action={{ label: t('重试'), onClick: () => void pagesQ.refetch() }}
      className="mt-[12vh]"
    />
  ) : page === undefined ? (
    <EmptyState
      testId="design-empty"
      icon={Globe}
      title={t('这个任务还没有网页')}
      className="mt-[12vh]"
    />
  ) : (
    <DesignPage
      key={page.fileName}
      todoId={target.todoId}
      page={page}
      pages={pages}
      readOnly={todoQ.data?.archivedAt != null}
      sendComments={sendComments}
    />
  );
  return (
    <aside
      data-testid="design-pane"
      aria-label={t('设计')}
      hidden={hidden}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-background max-[1100px]:border-l-0"
    >
      {head}
      {body}
    </aside>
  );
}

function DesignLoading() {
  const { t } = useI18n();
  return (
    <div data-testid="design-loading" aria-busy="true" className="flex min-h-0 flex-1 flex-col">
      <span role="status" className="sr-only">
        {t('正在加载网页')}
      </span>
      <div className="flex h-11 flex-none items-center gap-2 border-b border-border px-3">
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="m-6 min-h-0 flex-1 rounded-(--radius-tile)" />
    </div>
  );
}

function DesignPage({
  todoId,
  page,
  pages,
  readOnly,
  sendComments,
}: {
  todoId: string;
  page: DesignPageRecord;
  pages: readonly DesignPageRecord[];
  readOnly: boolean;
  sendComments: SendDesignComments | undefined;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const [, setSearchParams] = useSearchParams();
  const [viewport, setViewport] = useState<DesignViewport>('desktop');
  const [source, setSource] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [picked, setPicked] = useState<{ id: string; currentSeq: number } | null>(null);
  const versionsQ = useDesignVersions(todoId, page.fileName, live);
  const versions = versionsQ.data ?? [page.current];
  const shown: DesignVersionRecord =
    (picked !== null ? versions.find((v) => v.id === picked.id) : undefined) ?? page.current;
  const viewingOld = shown.id !== page.current.id;
  const htmlQ = useDesignPageHtml(shown.id);
  const srcdoc = useMemo(
    () => (htmlQ.data === undefined ? null : designSrcdoc(htmlQ.data)),
    [htmlQ.data],
  );
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { restore, createComment, patchComment, deleteComment } = useDesignMutations(
    todoId,
    page.fileName,
  );
  const [commenting, setCommenting] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const stopCommenting = useCallback(() => setCommenting(false), []);
  const commentsQ = useDesignComments(todoId, page.fileName, live);
  const comments = commentsQ.data ?? [];
  const activeComments = comments.filter((comment) => comment.status !== 'resolved').length;
  const canComment = !readOnly && live && !viewingOld && !source;
  const commentFailed = (message: string) => (error: unknown) => toastError(t(message), error);
  const actions: CommentActions = {
    edit: (id, note) =>
      patchComment.mutate({ id, patch: { note } }, { onError: commentFailed('评论没改成') }),
    remove: (id) => deleteComment.mutate(id, { onError: commentFailed('评论没删掉') }),
    resolve: (id) =>
      patchComment.mutate(
        { id, patch: { status: 'resolved' } },
        { onError: commentFailed('评论没改成') },
      ),
    reopen: (id) =>
      patchComment.mutate(
        { id, patch: { status: 'open' } },
        { onError: commentFailed('评论没改成') },
      ),
  };
  const createFrom = (
    target: Parameters<CommentDraftHandlers['save']>[0],
    note: string,
    then: (id: string) => void,
  ) =>
    createComment.mutate(
      { ...target, versionId: shown.id, viewport, note },
      {
        onSuccess: (row) => then(row.id),
        onError: commentFailed('评论没保存上'),
      },
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
  const pageHref = designPagePath(shown.id);
  const openPage = (name: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set(FILE_PARAM, name);
        return params;
      },
      { replace: true },
    );
  const restoreShown = () =>
    restore.mutate(shown.id, {
      onSuccess: () => setPicked(null),
      onError: (error) => toastError(t('没能切回这个版本'), error),
    });
  const missing = htmlQ.error instanceof ApiError && htmlQ.error.status === 404;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="design-toolbar"
        className="flex h-11 flex-none items-center gap-1 border-b border-border px-2"
      >
        {pages.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="design-page-picker"
                  className="min-w-0 gap-1 font-medium text-foreground"
                />
              }
            >
              <span className="truncate">{page.fileName}</span>
              <ChevronDown aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup
                value={page.fileName}
                onValueChange={(v) => openPage(String(v))}
              >
                {pages.map((item) => (
                  <DropdownMenuRadioItem
                    key={item.fileName}
                    value={item.fileName}
                    data-testid="design-page-option"
                  >
                    {item.fileName}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span
            data-testid="design-page-name"
            className="min-w-0 truncate px-2 text-ui font-medium text-foreground"
          >
            {page.fileName}
          </span>
        )}
        <span
          data-testid="design-version-meta"
          className="flex-none text-meta tabular-nums text-content-tertiary max-[640px]:hidden"
        >
          v{shown.seq} · {viewingOld ? t('旧版本') : t('当前')}
        </span>
        <span className="flex flex-none items-center max-[640px]:hidden">
          <IconTooltip
            label={t('重新加载')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="design-reload"
                className={HEAD_ICON}
                onClick={() => setReloads((n) => n + 1)}
              />
            }
          >
            <RotateCw aria-hidden className="size-4" />
          </IconTooltip>
          <IconTooltip
            label={source ? t('看预览') : t('看源码')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="design-source-toggle"
                aria-pressed={source}
                className={`${HEAD_ICON} aria-pressed:bg-(--hover-1) aria-pressed:text-foreground`}
                onClick={() => setSource((v) => !v)}
              />
            }
          >
            <Code aria-hidden className="size-4" />
          </IconTooltip>
        </span>
        <span className="min-w-0 flex-1" />
        <SegmentedTabs
          value={viewport}
          label={t('视口')}
          onChange={setViewport}
          options={(['desktop', 'tablet', 'mobile'] as const).map((value) => ({
            value,
            label: t(VIEWPORT_LABEL[value]),
            testId: `design-viewport-${value}`,
          }))}
        />
        {!readOnly && live && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="design-comment-mode"
            aria-pressed={commenting && canComment}
            disabled={!canComment}
            className="flex-none text-content-secondary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/80"
            onClick={() => setCommenting((on) => !on)}
          >
            {t('评论')}
          </Button>
        )}
        <VersionsMenu
          fileName={page.fileName}
          versions={versions}
          currentId={page.current.id}
          shownId={shown.id}
          onPick={(version) =>
            setPicked(
              version.id === page.current.id
                ? null
                : { id: version.id, currentSeq: page.current.seq },
            )
          }
        />
        {live && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="design-comments-toggle"
            aria-expanded={listOpen && !source}
            disabled={source}
            className="flex-none gap-1 text-content-secondary"
            onClick={() => setListOpen((open) => !open)}
          >
            {t('评论')}
            <span className="tabular-nums">{activeComments}</span>
          </Button>
        )}
        <DropdownMenu>
          <IconTooltip
            label={t('更多')}
            side="bottom"
            trigger={
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-testid="design-more"
                    className={HEAD_ICON}
                  />
                }
              />
            }
          >
            <Ellipsis aria-hidden className="size-4" />
          </IconTooltip>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              data-testid="design-open-browser"
              render={<a href={pageHref} target="_blank" rel="noopener noreferrer" />}
            >
              <Globe aria-hidden />
              {t('在浏览器打开')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="design-download"
              render={<a href={deliverableHref(shown.attachmentId)} download={page.fileName} />}
            >
              <Download aria-hidden />
              {t('下载')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="min-[641px]:hidden"
              onClick={() => setReloads((n) => n + 1)}
            >
              <RotateCw aria-hidden />
              {t('重新加载')}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-[641px]:hidden" onClick={() => setSource((v) => !v)}>
              <Code aria-hidden />
              {source ? t('看预览') : t('看源码')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {viewingOld && (
        <div
          data-testid="design-version-banner"
          className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-(--surface-1) px-3 py-2 text-ui text-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            {t('正在看 v{n}', { n: shown.seq })}
            {picked !== null && page.current.seq > picked.currentSeq && (
              <span data-testid="design-version-newer" className="text-content-secondary">
                {' · '}
                {t('有新版本 v{n}', { n: page.current.seq })}
              </span>
            )}
          </span>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              data-testid="design-version-restore"
              disabled={restore.isPending}
              onClick={restoreShown}
            >
              {t('切回这个版本')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            data-testid="design-version-current"
            onClick={() => setPicked(null)}
          >
            {t('回到当前')}
          </Button>
        </div>
      )}
      {missing ? (
        <EmptyState
          testId="design-missing"
          icon={FileWarning}
          title={t('这一版的文件已经不在了')}
          className="mt-[12vh]"
        />
      ) : htmlQ.isError ? (
        <EmptyState
          testId="design-error"
          icon={FileWarning}
          title={t('网页没加载出来')}
          description={t('检查网络后再试一次。')}
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
          <TextViewer name={page.fileName} text={htmlQ.data} />
        </div>
      ) : (
        <DesignCanvas
          key={`${shown.id}:${reloads}`}
          frameRef={frameRef}
          srcdoc={srcdoc}
          title={`${page.fileName} · ${versionLabel(shown, t)}`}
          viewport={viewport}
          commenting={commenting && canComment}
          onStopCommenting={stopCommenting}
          comments={comments}
          listOpen={listOpen}
          onListOpen={setListOpen}
          readOnly={readOnly}
          actions={actions}
          draft={draft}
        />
      )}
    </div>
  );
}
