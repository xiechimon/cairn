import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, FileText, ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { QueryBoundary } from '../components/query-state.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { attachmentUrl, type FileTarget, filePreviewKind } from './file-pane.js';

export const FILE_PREVIEW_MAX_LINES = 5000;

const COPIED_MS = 1500;

const HEAD_BTN_CLS = 'text-content-secondary hover:text-foreground';

async function fetchAttachmentText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`attachment read failed: ${res.status}`);
  return res.text();
}

export function fileLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
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

function FileTextView({ text }: { text: string }) {
  const { t } = useI18n();
  const lines = fileLines(text);
  const shown = lines.slice(0, FILE_PREVIEW_MAX_LINES);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-2 pb-4">
      <div
        data-testid="file-preview-text"
        className="grid flex-none grid-cols-[auto_minmax(0,1fr)] rounded-(--radius-tile) bg-(--card) font-mono text-code text-foreground inset-ring-1 inset-ring-(--border)"
      >
        <span aria-hidden className="h-2 border-r border-(--border)" />
        <span aria-hidden className="h-2" />
        {shown.map((line, index) => (
          <div key={index} data-slot="file-line" className="contents">
            <span
              aria-hidden
              className="min-w-10 border-r border-(--border) pr-2 pl-3 text-right text-content-tertiary tabular-nums select-none"
            >
              {index + 1}
            </span>
            <span className="min-w-0 px-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {line === '' ? '​' : line}
            </span>
          </div>
        ))}
        <span aria-hidden className="h-2 border-r border-(--border)" />
        <span aria-hidden className="h-2" />
      </div>
      {lines.length > shown.length && (
        <p
          data-testid="file-preview-truncated"
          className="m-0 px-1 pt-2 text-meta text-content-tertiary"
        >
          {t('只显示前 {n} 行，下载查看完整文件', { n: FILE_PREVIEW_MAX_LINES })}
        </p>
      )}
    </div>
  );
}

function FileImageView({
  name,
  src,
  onDownload,
}: {
  name: string;
  src: string;
  onDownload: () => void;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <EmptyState
        testId="file-preview-broken"
        icon={ImageOff}
        title={t('图片没能加载，下载查看')}
        action={{ label: t('下载'), onClick: onDownload }}
        className="mt-[10vh]"
      />
    );
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-2">
      <img
        data-testid="file-preview-image"
        src={src}
        alt={name}
        className="max-h-full max-w-full rounded-(--radius-tile) object-contain"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

export function FilePreviewPanel({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const { search } = useLocation();
  const kind = filePreviewKind(target.key);
  const fixture = live
    ? undefined
    : resolveScenario(new URLSearchParams(search)).attachments?.[attachmentIdFromKey(target.key)];
  const url = attachmentUrl(target.key);
  const fixtureText = fixture?.text;
  const textQ = useQuery({
    queryKey: ['attachment-text', target.key, fixtureText ?? null],
    queryFn: () =>
      fixtureText !== undefined ? Promise.resolve(fixtureText) : fetchAttachmentText(url),
    enabled: kind === 'text',
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const downloadHref =
    fixture?.src ??
    (fixtureText !== undefined
      ? `data:text/plain;charset=utf-8,${encodeURIComponent(fixtureText)}`
      : url);
  const download = () => downloadFile(downloadHref, target.name);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const text = kind === 'text' ? textQ.data : undefined;
  const copy = () => {
    if (text === undefined) return;
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      (error: unknown) => toastError(t('没能复制，再试一次'), error),
    );
  };
  const body =
    kind === 'text' ? (
      <QueryBoundary
        query={textQ}
        isEmpty={false}
        errorWins
        empty={null}
        loadingLabel={t('正在加载文件')}
        errorTitle={t('文件没能加载')}
        className="px-2"
      >
        <FileTextView text={text ?? ''} />
      </QueryBoundary>
    ) : kind === 'image' ? (
      <FileImageView key={url} name={target.name} src={fixture?.src ?? url} onDownload={download} />
    ) : kind === 'pdf' && fixture === undefined ? (
      <div className="flex min-h-0 flex-1 p-2">
        <iframe
          data-testid="file-preview-pdf"
          title={target.name}
          src={url}
          className="min-h-0 flex-1 rounded-(--radius-tile) border-0 inset-ring-1 inset-ring-(--border)"
        />
      </div>
    ) : (
      <EmptyState
        testId="file-preview-unsupported"
        icon={FileText}
        title={t('无法预览，下载查看')}
        action={{ label: t('下载'), onClick: download }}
        className="mt-[10vh]"
      />
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
