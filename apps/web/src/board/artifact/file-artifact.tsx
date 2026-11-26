import { type ArtifactOfAttachment, artifactKindOf, type DesignCommentRecord } from '@cairn/shared';
import { Check, ChevronDown, Copy, Download, FileText, Globe, Pencil } from 'lucide-react';
import { type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useDesignMutations } from '../../api/hooks.js';
import { useLiveData } from '../../api/provider.js';
import { CopyIconButton } from '../../components/copy-icon-button.js';
import { EmptyState } from '../../components/empty-state.js';
import { KeyedMenuContent, KeyedMenuItem } from '../../components/menu-keys.js';
import { QueryBoundary } from '../../components/query-state.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.js';
import { toastError } from '../../components/ui/toaster.js';
import { DiagramView } from '../../detail/mermaid-block.js';
import { useI18n } from '../../i18n/provider.js';
import { AudioViewer } from '../../vendor-open-design/viewers/audio-viewer.js';
import { BinaryViewer } from '../../vendor-open-design/viewers/binary-viewer.js';
import { DocumentPreviewViewer } from '../../vendor-open-design/viewers/document-preview-viewer.js';
import { MarkdownViewer } from '../../vendor-open-design/viewers/markdown-viewer.js';
import { SvgViewer } from '../../vendor-open-design/viewers/svg-viewer.js';
import { TextViewer } from '../../vendor-open-design/viewers/text-viewer.js';
import { VideoViewer } from '../../vendor-open-design/viewers/video-viewer.js';
import { DocumentPreviewUnavailable, useAttachmentFiles } from '../file-data.js';
import { downloadFile, type FileTarget, OpenFileContext } from '../file-pane.js';
import { MadeFiles } from '../made-files.js';
import { ThreadUpdatesBlock } from '../thread-updates-block.js';
import { useArtifactEscape, useArtifactPanelControl } from './artifact-panel.js';
import { artifactKey } from './artifact-route.js';
import { ArtifactToolbar, OldVersionBar, TOOL_BUTTON, VersionHistory } from './artifact-toolbar.js';
import {
  COMMENT_KINDS,
  CommentLayerProvider,
  RegionSurface,
  useFileComments,
} from './file-comments.js';
import {
  type InlineArtifactMeta,
  isInlineArtifactKey,
  useInlineArtifact,
} from './inline-artifact.js';
import type { SendDesignComments } from './page-artifact.js';
import { useArtifactVersions } from './use-artifact-versions.js';
import { CodeComments } from './viewers/code-comments.js';
import { DocxViewer } from './viewers/docx-viewer.js';
import { MarkdownComments } from './viewers/markdown-comments.js';
import { PdfViewer } from './viewers/pdf-viewer.js';
import { SheetViewer } from './viewers/sheet-viewer.js';
import type { SceneReader } from './viewers/whiteboard-canvas.js';
import { WhiteboardViewer } from './viewers/whiteboard-viewer.js';
import { useZoomShortcuts, type Zoom, ZoomControl } from './viewers/zoom.js';
import { ZoomImage } from './viewers/zoom-image.js';

const INLINE_KINDS = new Set(['image', 'svg', 'video', 'audio', 'pdf']);
const SOURCE_KINDS = new Set(['sheet', 'diagram', 'whiteboard']);
const REGION_WRAPPED = new Set(['design', 'diagram', 'whiteboard']);

const COMMENT_HINT: Record<string, string> = {
  code: '选中几行，或点一个行号',
  sheet: '点一个单元格，或拖选一片',
  document: '点一段文字加批注',
  video: '停在要改的那一刻，点右边的按钮',
};

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type FileComments = ReturnType<typeof useFileComments>;

type Mode = 'preview' | 'source';

export function FileArtifact({
  target,
  artifact,
  readOnly,
  sendComments,
}: {
  target: FileTarget;
  artifact: ArtifactOfAttachment | null;
  readOnly: boolean;
  sendComments: SendDesignComments | undefined;
}) {
  const { t } = useI18n();
  const inlineMeta = useInlineArtifact(target.key);
  if (artifact === null) {
    if (isInlineArtifactKey(target.key) && inlineMeta === null) {
      return (
        <EmptyState
          testId="artifact-inline-missing"
          icon={FileText}
          title={t('文档已关闭')}
          description={t('请回到对话里重新打开这篇内容。')}
          className="mt-[10vh]"
        />
      );
    }
    return <FileView fileKey={target.key} name={target.name} inlineMeta={inlineMeta} />;
  }
  return (
    <VersionedFile
      target={target}
      artifact={artifact}
      readOnly={readOnly}
      sendComments={sendComments}
      inlineMeta={inlineMeta}
    />
  );
}

function locate(body: HTMLElement | null, comment: DesignCommentRecord) {
  if (body === null || comment.anchor === null) return;
  if (comment.anchor.type === 'time') {
    const video = body.querySelector('video');
    if (video !== null) video.currentTime = comment.anchor.seconds;
    return;
  }
  const page = comment.anchor.type === 'region' ? comment.anchor.page : undefined;
  if (page !== undefined)
    body.querySelector(`[data-testid="artifact-pdf-page"][data-page="${page}"]`)?.scrollIntoView({
      block: 'start',
    });
}

function VersionedFile({
  target,
  artifact,
  readOnly,
  sendComments,
  inlineMeta,
}: {
  target: FileTarget;
  artifact: ArtifactOfAttachment;
  readOnly: boolean;
  sendComments: SendDesignComments | undefined;
  inlineMeta: InlineArtifactMeta | null;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const { active: panelActive } = useArtifactPanelControl();
  const versions = useArtifactVersions(artifact.todoId, artifact.fileName, artifact.versionId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  useArtifactEscape(panelActive && historyOpen, closeHistory);
  const { shown, page } = versions;
  const { saveVersion } = useDesignMutations(artifact.todoId, artifact.fileName);
  const editable = live && !readOnly && !versions.viewingOld;
  const fileKey =
    shown === undefined ? target.key : artifactKey(shown.attachmentId, artifact.fileName);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const comments = useFileComments({
    todoId: artifact.todoId,
    fileName: artifact.fileName,
    versionId: shown?.id,
    enabled: live && COMMENT_KINDS.has(artifact.kind) && inlineMeta?.readOnly !== true,
    readOnly: readOnly || versions.viewingOld,
    sendComments,
    onLocate: (comment) => locate(body, comment),
  });
  return (
    <FileView
      key={fileKey}
      fileKey={fileKey}
      name={artifact.fileName}
      inlineMeta={versions.viewingOld ? null : inlineMeta}
      comments={comments}
      onBody={setBody}
      history={{ open: historyOpen, toggle: () => setHistoryOpen((open) => !open) }}
      save={
        editable
          ? {
              busy: saveVersion.isPending,
              run: (content, done) =>
                saveVersion.mutate(content, {
                  onSuccess: done,
                  onError: (error) => toastError(t('白板未能保存'), error),
                }),
            }
          : null
      }
      banner={
        versions.viewingOld && shown !== undefined && page !== undefined ? (
          <OldVersionBar
            shown={shown}
            current={page.current}
            readOnly={readOnly}
            restoring={versions.restoring}
            onRestore={versions.restoreShown}
            onCurrent={versions.showCurrent}
          />
        ) : null
      }
      aside={
        historyOpen && shown !== undefined && page !== undefined ? (
          <VersionHistory
            versions={versions.versions}
            currentId={page.current.id}
            shownId={shown.id}
            onPick={versions.pick}
            onClose={() => setHistoryOpen(false)}
          />
        ) : null
      }
    />
  );
}

function ReportDocumentHeader({ meta }: { meta: InlineArtifactMeta }) {
  const { t } = useI18n();
  const openFile = useContext(OpenFileContext);
  const stage = meta.stage ?? null;
  const when = meta.when ?? null;
  return (
    <header className="mb-7 border-b border-border pb-6">
      <p
        data-testid="research-report-meta"
        className="m-0 flex items-center gap-1.5 text-meta text-content-tertiary"
      >
        <FileText aria-hidden="true" className="size-4 flex-none" />
        <span>{meta.label ?? t('调研报告')}</span>
        {stage !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{stage}</span>
          </>
        )}
        {when !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{when}</span>
          </>
        )}
      </p>
      <h2 className="mt-3 m-0 voice-title text-page text-foreground">{meta.title}</h2>
      {meta.updates != null && <ThreadUpdatesBlock updates={meta.updates} />}
      <MadeFiles
        deliverables={meta.deliverables}
        {...(openFile === undefined
          ? {}
          : {
              onOpen: (item) =>
                openFile({ name: item.name, key: artifactKey(item.attachmentId, item.name) }),
            })}
      />
    </header>
  );
}

function FileView({
  fileKey,
  name,
  inlineMeta = null,
  history = null,
  save = null,
  banner = null,
  aside = null,
  comments = null,
  onBody,
}: {
  fileKey: string;
  name: string;
  inlineMeta?: InlineArtifactMeta | null;
  history?: { open: boolean; toggle: () => void } | null;
  save?: { busy: boolean; run: (content: string, done: () => void) => void } | null;
  banner?: ReactNode;
  aside?: ReactNode;
  comments?: FileComments | null;
  onBody?: (body: HTMLElement | null) => void;
}) {
  const { t } = useI18n();
  const files = useAttachmentFiles(fileKey, {
    size: true,
    ...(inlineMeta !== null ? { fallbackText: inlineMeta.markdown } : {}),
  });
  const { kind, src, downloadHref, readsText, readsDocument, size } = files;
  const textQ = files.text;
  const documentQ = files.document;
  const downloadName =
    inlineMeta === null
      ? name
      : name.toLowerCase().endsWith('.md')
        ? name
        : `${inlineMeta.title}.md`;
  const toolbarName =
    inlineMeta === null
      ? name
      : inlineMeta.title.toLowerCase().endsWith('.md')
        ? inlineMeta.title
        : `${inlineMeta.title}.md`;
  const download = () => downloadFile(downloadHref, downloadName);
  const artifactKind = artifactKindOf(name);
  const { active: panelActive } = useArtifactPanelControl();
  const [mode, setMode] = useState<Mode>('preview');
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitScale, setFitScale] = useState(1);
  const zoomSupported =
    kind === 'image' ||
    kind === 'pdf' ||
    (kind === 'svg' && mode === 'preview') ||
    (artifactKind === 'diagram' && mode === 'preview');
  useZoomShortcuts({
    active: panelActive && zoomSupported,
    scale: zoom === 'fit' ? fitScale : zoom,
    onChange: setZoom,
  });
  const [editing, setEditing] = useState(false);
  const sceneReader = useRef<SceneReader | null>(null);
  const keepReader = useCallback((read: SceneReader | null) => {
    sceneReader.current = read;
  }, []);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => onBody?.(bodyEl), [onBody, bodyEl]);
  const text = readsText ? textQ.data : undefined;
  const withText = (render: (value: string) => ReactNode) => (
    <QueryBoundary
      query={textQ}
      isEmpty={false}
      errorWins
      empty={null}
      loadingLabel={t('正在加载文件')}
      errorTitle={t('文件未能加载')}
      className="px-2"
    >
      {render(text ?? '')}
    </QueryBoundary>
  );
  const binary = <BinaryViewer size={size} onDownload={download} />;
  const source = withText((value) => <TextViewer name={fileKey} text={value} />);
  const extracted = readsDocument ? (
    documentQ.error instanceof DocumentPreviewUnavailable ? (
      binary
    ) : (
      <QueryBoundary
        query={documentQ}
        isEmpty={false}
        errorWins
        empty={null}
        loadingLabel={t('正在加载文件')}
        errorTitle={t('文件未能加载')}
        className="px-2"
      >
        {documentQ.data !== undefined && (
          <DocumentPreviewViewer preview={documentQ.data} size={size} />
        )}
      </QueryBoundary>
    )
  ) : (
    binary
  );
  const body =
    SOURCE_KINDS.has(artifactKind) && mode === 'source' ? (
      source
    ) : artifactKind === 'sheet' ? (
      withText((value) => <SheetViewer name={name} text={value} />)
    ) : artifactKind === 'diagram' ? (
      withText((value) => (
        <DiagramView
          text={value}
          source={<TextViewer name={fileKey} text={value} />}
          zoom={zoom}
          onFitScale={setFitScale}
          onZoomChange={setZoom}
        />
      ))
    ) : artifactKind === 'whiteboard' ? (
      withText((value) => <WhiteboardViewer text={value} editing={editing} onReader={keepReader} />)
    ) : artifactKind === 'code' && kind === 'text' ? (
      withText((value) => <CodeComments name={fileKey} text={value} />)
    ) : kind === 'markdown' && mode === 'preview' ? (
      withText((value) => (
        <MarkdownComments
          text={value}
          header={inlineMeta !== null ? <ReportDocumentHeader meta={inlineMeta} /> : undefined}
          docTestId={inlineMeta !== null ? 'research-report-doc' : undefined}
          docClassName={
            inlineMeta !== null ? 'report-doc font-sans break-words text-foreground' : undefined
          }
        />
      ))
    ) : kind === 'pdf' ? (
      <PdfViewer src={src} zoom={zoom} onFitScale={setFitScale} onChange={setZoom} />
    ) : artifactKind === 'docx' ? (
      <DocxViewer src={src} fallback={extracted} />
    ) : kind === 'markdown' ? (
      withText((value) => <MarkdownViewer text={value} mode={mode} />)
    ) : kind === 'text' ? (
      source
    ) : kind === 'svg' ? (
      mode === 'source' ? (
        withText((value) => (
          <SvgViewer name={name} src={src} mode="source" source={value} onDownload={download} />
        ))
      ) : (
        <ZoomImage
          name={name}
          src={src}
          zoom={zoom}
          onFitScale={setFitScale}
          onChange={setZoom}
          onDownload={download}
        />
      )
    ) : kind === 'image' ? (
      <ZoomImage
        name={name}
        src={src}
        zoom={zoom}
        onFitScale={setFitScale}
        onChange={setZoom}
        onDownload={download}
      />
    ) : kind === 'video' ? (
      <VideoViewer name={name} src={src} onDownload={download} />
    ) : kind === 'audio' ? (
      <AudioViewer name={name} src={src} onDownload={download} />
    ) : kind === 'document' ? (
      extracted
    ) : (
      binary
    );
  const commentsOn = comments?.layer.commenting ?? false;
  const wrappedBody =
    REGION_WRAPPED.has(artifactKind) && mode === 'preview' && !editing ? (
      <div className="relative flex min-h-0 flex-1 flex-col">
        {body}
        <RegionSurface />
      </div>
    ) : (
      body
    );
  const timeTool =
    kind === 'video' && comments !== null
      ? {
          label: t('在这一刻加批注'),
          testId: 'artifact-comment-at-time',
          onClick: () => {
            const video = bodyEl?.querySelector('video');
            if (video == null || bodyEl === null) return;
            video.pause();
            const box = bodyEl.getBoundingClientRect();
            comments.layer.pick({
              anchor: { type: 'time', seconds: video.currentTime },
              element: {
                selector: '',
                label: formatTime(video.currentTime),
                text: '',
              },
              point: { x: box.left + box.width / 2 - 150, y: box.top + 16 },
            });
          },
        }
      : undefined;
  const controls = (
    <>
      {zoomSupported && <ZoomControl zoom={zoom} fitScale={fitScale} onChange={setZoom} />}
      {artifactKind === 'whiteboard' && save !== null && mode === 'preview' && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="artifact-whiteboard-edit"
          aria-pressed={editing}
          disabled={save.busy}
          onClick={() => {
            if (!editing) return setEditing(true);
            const read = sceneReader.current;
            if (read === null) return setEditing(false);
            save.run(read(), () => setEditing(false));
          }}
          className={TOOL_BUTTON}
        >
          <Pencil aria-hidden className="size-4" />
          {editing ? t('保存') : t('编辑')}
        </Button>
      )}
      {(kind === 'markdown' || kind === 'svg' || SOURCE_KINDS.has(artifactKind)) && (
        <SegmentedTabs
          value={mode}
          label={t('显示方式')}
          onChange={setMode}
          options={[
            { value: 'preview', label: t('预览'), testId: 'artifact-mode-preview' },
            { value: 'source', label: t('源码'), testId: 'artifact-mode-source' },
          ]}
        />
      )}
      {readsText && (
        <CopyIconButton
          text={text ?? ''}
          label={kind === 'markdown' && mode === 'preview' ? t('复制为 Markdown') : t('复制')}
          copiedLabel={t('已复制')}
          side="bottom"
          size="icon-sm"
          testId="artifact-copy"
          disabled={text === undefined}
          replaceClassName
          className={`${TOOL_BUTTON} w-7 px-0`}
          icons={{
            copy: <Copy aria-hidden className="size-4" />,
            copied: <Check aria-hidden className="size-4" />,
          }}
        />
      )}
    </>
  );
  return (
    <>
      <ArtifactToolbar
        name={toolbarName}
        menu={
          <>
            <KeyedMenuItem
              shortcut="D"
              data-testid="artifact-download"
              render={<a href={downloadHref} download={downloadName} />}
            >
              <Download aria-hidden />
              {t('下载')}
            </KeyedMenuItem>
            {INLINE_KINDS.has(kind) && (
              <KeyedMenuItem
                shortcut="B"
                data-testid="artifact-open-browser"
                render={<a href={src} target="_blank" rel="noopener noreferrer" />}
              >
                <Globe aria-hidden />
                {t('在浏览器打开')}
              </KeyedMenuItem>
            )}
          </>
        }
        controls={controls}
        comments={
          comments?.toolbar == null
            ? null
            : {
                ...comments.toolbar,
                disabled: mode === 'source' && artifactKind !== 'code',
              }
        }
        history={history}
        exportMenu={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="artifact-export"
                  className={TOOL_BUTTON}
                />
              }
            >
              <Download aria-hidden className="size-4" />
              <span className="max-[640px]:sr-only">{t('导出')}</span>
              <ChevronDown aria-hidden className="size-4 text-content-tertiary" />
            </DropdownMenuTrigger>
            <KeyedMenuContent align="end" className="w-52">
              <KeyedMenuItem shortcut="D" onClick={download}>
                <Download aria-hidden />
                {t('下载原文件')}
              </KeyedMenuItem>
            </KeyedMenuContent>
          </DropdownMenu>
        }
      />
      {banner}
      {comments?.strip?.({
        hint: t(COMMENT_HINT[artifactKind] ?? '点击一处，或按住拖出一块区域'),
        ...(timeTool !== undefined ? { tool: timeTool } : {}),
      })}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={setBodyEl}
          data-testid="artifact-body"
          data-kind={kind}
          data-commenting={commentsOn || undefined}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <CommentLayerProvider layer={comments?.layer ?? null}>{wrappedBody}</CommentLayerProvider>
          {comments?.composer?.(bodyEl)}
        </div>
        {comments?.list}
        {aside}
      </div>
    </>
  );
}
