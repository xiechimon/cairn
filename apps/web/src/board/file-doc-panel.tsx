import { Check, Copy, Download } from 'lucide-react';
import { type ReactNode, useContext, useEffect, useState } from 'react';
import { FileGlyph } from '../components/file-glyph.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary } from '../components/query-state.js';
import { SegmentedTabs } from '../components/segmented.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { useEscClose } from '../overlay/use-esc.js';
import { AudioViewer } from '../vendor-open-design/viewers/audio-viewer.js';
import { BinaryViewer } from '../vendor-open-design/viewers/binary-viewer.js';
import { DocumentPreviewViewer } from '../vendor-open-design/viewers/document-preview-viewer.js';
import { MarkdownViewer } from '../vendor-open-design/viewers/markdown-viewer.js';
import { TextViewer } from '../vendor-open-design/viewers/text-viewer.js';
import { DocumentPreviewUnavailable, fileMetaLabel, useAttachmentFiles } from './file-data.js';
import { downloadFile } from './file-lightbox.js';
import { type FileTarget, OpenDocumentContext } from './file-pane.js';

const COPIED_MS = 1500;

type MarkdownMode = 'preview' | 'source';

export function useOpenDocument() {
  return useContext(OpenDocumentContext);
}

export function FileDocPanel() {
  const document = useOpenDocument();
  if (document === null) return null;
  return (
    <FileDocPanelView key={document.target.key} target={document.target} onClose={document.close} />
  );
}

function FileDocPanelView({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const { t } = useI18n();
  const files = useAttachmentFiles(target.key, { size: true });
  const { kind, src, url, fixture, downloadHref, readsText, readsDocument, size } = files;
  const textQ = files.text;
  const documentQ = files.document;
  const download = () => downloadFile(downloadHref, target.name);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<MarkdownMode>('preview');
  useEscClose(onClose);
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
      withText((value) => <TextViewer name={target.key} text={value} />)
    ) : kind === 'audio' ? (
      <AudioViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'pdf' && fixture === undefined ? (
      <iframe
        data-testid="file-preview-pdf"
        title={target.name}
        src={url}
        className="min-h-0 flex-1 border-0"
      />
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
  return (
    <SidePanel label={target.name} onDismiss={onClose} testId="file-panel">
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose} className="gap-1.5 pr-2">
        <SidePanelTitle className="gap-2 text-ui">
          <FileGlyph name={target.key} />
          <span data-testid="file-preview-name" className="min-w-12 truncate" title={target.name}>
            {target.name}
          </span>
          {kind !== 'markdown' && (
            <span
              data-testid="file-preview-meta"
              className="flex-none text-meta text-content-tertiary tabular-nums"
            >
              {fileMetaLabel(target.key, size)}
            </span>
          )}
        </SidePanelTitle>
        {kind === 'markdown' && (
          <SegmentedTabs
            value={mode}
            label={t('显示方式')}
            onChange={setMode}
            options={[
              { value: 'preview', label: t('预览'), testId: 'file-preview-mode-preview' },
              { value: 'source', label: t('源码'), testId: 'file-preview-source-toggle' },
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
                data-testid="file-preview-copy"
                disabled={text === undefined}
                onClick={copy}
                className="text-content-secondary hover:text-foreground"
              />
            }
          >
            {copied ? (
              <Check aria-hidden strokeWidth={1.75} className="size-5" />
            ) : (
              <Copy aria-hidden strokeWidth={1.75} className="size-5" />
            )}
          </IconTooltip>
        )}
        <IconTooltip
          label={t('下载')}
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="file-preview-download"
              nativeButton={false}
              render={<a href={downloadHref} download={target.name} />}
              className="text-content-secondary hover:text-foreground"
            />
          }
        >
          <Download aria-hidden strokeWidth={1.75} className="size-5" />
        </IconTooltip>
      </SidePanelHead>
      <div
        data-testid="file-preview-body"
        className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border"
      >
        {body}
      </div>
    </SidePanel>
  );
}
