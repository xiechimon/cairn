import type { ArtifactOfAttachment } from '@cairn/shared';
import { Check, Copy, Download, Globe } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { IconTooltip } from '../../components/icon-tooltip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../../components/menu-keys.js';
import { QueryBoundary } from '../../components/query-state.js';
import { SegmentedTabs } from '../../components/segmented.js';
import { Button } from '../../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../../components/ui/dropdown-menu.js';
import { toastError } from '../../components/ui/toaster.js';
import { useI18n } from '../../i18n/provider.js';
import { ChevronDown } from '../../icons/index.js';
import { AudioViewer } from '../../vendor-open-design/viewers/audio-viewer.js';
import { BinaryViewer } from '../../vendor-open-design/viewers/binary-viewer.js';
import { DocumentPreviewViewer } from '../../vendor-open-design/viewers/document-preview-viewer.js';
import { ImageViewer } from '../../vendor-open-design/viewers/image-viewer.js';
import { MarkdownViewer } from '../../vendor-open-design/viewers/markdown-viewer.js';
import { SvgViewer } from '../../vendor-open-design/viewers/svg-viewer.js';
import { TextViewer } from '../../vendor-open-design/viewers/text-viewer.js';
import { VideoViewer } from '../../vendor-open-design/viewers/video-viewer.js';
import { DocumentPreviewUnavailable, useAttachmentFiles } from '../file-data.js';
import { downloadFile, type FileTarget } from '../file-pane.js';
import { artifactKey } from './artifact-route.js';
import { ArtifactToolbar, OldVersionBar, TOOL_BUTTON, VersionHistory } from './artifact-toolbar.js';
import { useArtifactVersions } from './use-artifact-versions.js';

const COPIED_MS = 1500;
const INLINE_KINDS = new Set(['image', 'svg', 'video', 'audio']);

type Mode = 'preview' | 'source';

export function FileArtifact({
  target,
  artifact,
  readOnly,
}: {
  target: FileTarget;
  artifact: ArtifactOfAttachment | null;
  readOnly: boolean;
}) {
  if (artifact === null) return <FileView fileKey={target.key} name={target.name} />;
  return <VersionedFile target={target} artifact={artifact} readOnly={readOnly} />;
}

function VersionedFile({
  target,
  artifact,
  readOnly,
}: {
  target: FileTarget;
  artifact: ArtifactOfAttachment;
  readOnly: boolean;
}) {
  const versions = useArtifactVersions(artifact.todoId, artifact.fileName, artifact.versionId);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { shown, page } = versions;
  const fileKey =
    shown === undefined ? target.key : artifactKey(shown.attachmentId, artifact.fileName);
  return (
    <FileView
      key={fileKey}
      fileKey={fileKey}
      name={artifact.fileName}
      history={{ open: historyOpen, toggle: () => setHistoryOpen((open) => !open) }}
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

function FileView({
  fileKey,
  name,
  history = null,
  banner = null,
  aside = null,
}: {
  fileKey: string;
  name: string;
  history?: { open: boolean; toggle: () => void } | null;
  banner?: ReactNode;
  aside?: ReactNode;
}) {
  const { t } = useI18n();
  const files = useAttachmentFiles(fileKey, { size: true });
  const { kind, src, downloadHref, readsText, readsDocument, size } = files;
  const textQ = files.text;
  const documentQ = files.document;
  const download = () => downloadFile(downloadHref, name);
  const [mode, setMode] = useState<Mode>('preview');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const text = readsText ? textQ.data : undefined;
  const copy = () => {
    if (text === undefined) return;
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      (error: unknown) => toastError(t('未能复制，请重试'), error),
    );
  };
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
  const body =
    kind === 'markdown' ? (
      withText((value) => <MarkdownViewer text={value} mode={mode} />)
    ) : kind === 'text' ? (
      withText((value) => <TextViewer name={fileKey} text={value} />)
    ) : kind === 'svg' ? (
      mode === 'source' ? (
        withText((value) => (
          <SvgViewer name={name} src={src} mode="source" source={value} onDownload={download} />
        ))
      ) : (
        <SvgViewer name={name} src={src} mode="preview" source="" onDownload={download} />
      )
    ) : kind === 'image' ? (
      <ImageViewer name={name} src={src} onDownload={download} />
    ) : kind === 'video' ? (
      <VideoViewer name={name} src={src} onDownload={download} />
    ) : kind === 'audio' ? (
      <AudioViewer name={name} src={src} onDownload={download} />
    ) : kind === 'document' && readsDocument ? (
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
  const controls = (
    <>
      {(kind === 'markdown' || kind === 'svg') && (
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
        <IconTooltip
          label={copied ? t('已复制') : t('复制')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="artifact-copy"
              disabled={text === undefined}
              onClick={copy}
              className={`${TOOL_BUTTON} w-7 px-0`}
            />
          }
        >
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
        </IconTooltip>
      )}
    </>
  );
  return (
    <>
      <ArtifactToolbar
        name={name}
        menu={
          <>
            <KeyedMenuItem
              shortcut="D"
              data-testid="artifact-download"
              render={<a href={downloadHref} download={name} />}
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
        comments={null}
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
      <div className="relative flex min-h-0 flex-1">
        <div
          data-testid="artifact-body"
          data-kind={kind}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          {body}
        </div>
        {aside}
      </div>
    </>
  );
}
