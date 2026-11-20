import { useQuery } from '@tanstack/react-query';
import { Check, Code, Copy, Download, Eye } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { AudioViewer } from '../vendor-open-design/viewers/audio-viewer.js';
import { BinaryViewer } from '../vendor-open-design/viewers/binary-viewer.js';
import {
  type DocumentPreview,
  DocumentPreviewViewer,
} from '../vendor-open-design/viewers/document-preview-viewer.js';
import { kindFor } from '../vendor-open-design/viewers/file-kind.js';
import { ImageViewer } from '../vendor-open-design/viewers/image-viewer.js';
import { MarkdownViewer } from '../vendor-open-design/viewers/markdown-viewer.js';
import { SvgViewer } from '../vendor-open-design/viewers/svg-viewer.js';
import { TextViewer } from '../vendor-open-design/viewers/text-viewer.js';
import { VideoViewer } from '../vendor-open-design/viewers/video-viewer.js';
import { attachmentUrl, type FileTarget } from './file-pane.js';

const COPIED_MS = 1500;

const HEAD_BTN_CLS = 'text-content-secondary hover:text-foreground';

const DOCUMENT_UNAVAILABLE_STATUSES = new Set([413, 415, 422]);

class DocumentPreviewUnavailable extends Error {}

async function fetchAttachmentText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`attachment read failed: ${res.status}`);
  return res.text();
}

async function fetchDocumentPreview(url: string): Promise<DocumentPreview> {
  const res = await fetch(`${url}/document-preview`, { credentials: 'same-origin' });
  if (DOCUMENT_UNAVAILABLE_STATUSES.has(res.status))
    throw new DocumentPreviewUnavailable(`document preview unavailable: ${res.status}`);
  if (!res.ok) throw new Error(`document preview failed: ${res.status}`);
  return (await res.json()) as DocumentPreview;
}

async function fetchAttachmentSize(url: string): Promise<number | null> {
  const res = await fetch(url, { method: 'HEAD', credentials: 'same-origin' });
  const length = res.ok ? Number(res.headers.get('content-length')) : Number.NaN;
  return Number.isFinite(length) && length > 0 ? length : null;
}

function downloadFile(href: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function FilePreviewPanel({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const { search } = useLocation();
  const kind = kindFor(target.key);
  const fixture = live
    ? undefined
    : resolveScenario(new URLSearchParams(search)).attachments?.[attachmentIdFromKey(target.key)];
  const url = attachmentUrl(target.key);
  const src = fixture?.src ?? url;
  const fixtureText = fixture?.text;
  const readsText = kind === 'markdown' || kind === 'text' || kind === 'svg';
  const textQ = useQuery({
    queryKey: ['attachment-text', target.key, fixtureText ?? null],
    queryFn: () =>
      fixtureText !== undefined ? Promise.resolve(fixtureText) : fetchAttachmentText(url),
    enabled: readsText,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const fixtureDocument = fixture?.document;
  const readsDocument = kind === 'document' && (live || fixtureDocument !== undefined);
  const documentQ = useQuery({
    queryKey: ['attachment-document-preview', target.key, fixtureDocument ?? null],
    queryFn: () =>
      fixtureDocument !== undefined ? Promise.resolve(fixtureDocument) : fetchDocumentPreview(url),
    enabled: readsDocument,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const sizeQ = useQuery({
    queryKey: ['attachment-size', target.key],
    queryFn: () => fetchAttachmentSize(url),
    enabled: live && (kind === 'document' || kind === 'binary'),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const size = sizeQ.data ?? undefined;
  const downloadHref =
    fixture?.src ??
    (fixtureText !== undefined
      ? `data:text/plain;charset=utf-8,${encodeURIComponent(fixtureText)}`
      : `${url}?download=1`);
  const download = () => downloadFile(downloadHref, target.name);
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const togglesSource = kind === 'markdown' || kind === 'svg';
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
      (error: unknown) => toastError(t('没能复制，再试一次'), error),
    );
  };
  const withText = (render: (value: string) => ReactNode) => (
    <QueryBoundary
      query={textQ}
      isEmpty={false}
      errorWins
      empty={null}
      loadingLabel={t('正在加载文件')}
      errorTitle={t('文件没能加载')}
      className="px-2"
    >
      {render(text ?? '')}
    </QueryBoundary>
  );
  const binary = <BinaryViewer size={size} onDownload={download} />;
  const body =
    kind === 'markdown' ? (
      withText((value) => <MarkdownViewer text={value} mode={showSource ? 'source' : 'preview'} />)
    ) : kind === 'text' ? (
      withText((value) => <TextViewer name={target.key} text={value} />)
    ) : kind === 'svg' ? (
      showSource ? (
        withText((value) => (
          <SvgViewer
            name={target.name}
            src={src}
            mode="source"
            source={value}
            onDownload={download}
          />
        ))
      ) : (
        <SvgViewer
          key={src}
          name={target.name}
          src={src}
          mode="preview"
          source=""
          onDownload={download}
        />
      )
    ) : kind === 'image' ? (
      <ImageViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'video' ? (
      <VideoViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'audio' ? (
      <AudioViewer key={src} name={target.name} src={src} onDownload={download} />
    ) : kind === 'pdf' && fixture === undefined ? (
      <div className="flex min-h-0 flex-1 p-2">
        <iframe
          data-testid="file-preview-pdf"
          title={target.name}
          src={url}
          className="min-h-0 flex-1 rounded-(--radius-tile) border-0 inset-ring-1 inset-ring-(--border)"
        />
      </div>
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
          errorTitle={t('文件没能加载')}
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
    <SidePanel label={target.name} onDismiss={onClose} testId="file-preview-panel">
      <SidePanelHead
        closeLabel={t('关闭')}
        onClose={onClose}
        className="gap-1 border-b border-border"
      >
        <SidePanelTitle className="pr-1 text-ui">
          <span data-testid="file-preview-name" className="truncate" title={target.name}>
            {target.name}
          </span>
        </SidePanelTitle>
        {togglesSource && (
          <IconTooltip
            label={showSource ? t('查看渲染效果') : t('查看源码')}
            side="bottom"
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                data-testid="file-preview-source-toggle"
                disabled={text === undefined}
                onClick={() => setShowSource((current) => !current)}
                className={HEAD_BTN_CLS}
              />
            }
          >
            {showSource ? (
              <Eye aria-hidden className="size-5.5" />
            ) : (
              <Code aria-hidden className="size-5.5" />
            )}
          </IconTooltip>
        )}
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
              className={HEAD_BTN_CLS}
            />
          }
        >
          {copied ? (
            <Check aria-hidden className="size-5.5" />
          ) : (
            <Copy aria-hidden className="size-5.5" />
          )}
        </IconTooltip>
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
              className={HEAD_BTN_CLS}
            />
          }
        >
          <Download aria-hidden className="size-5.5" />
        </IconTooltip>
      </SidePanelHead>
      {body}
    </SidePanel>
  );
}
