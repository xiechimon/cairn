import { attachmentExtOf } from '@cairn/shared';
import { cn } from 'cn';
import { Maximize2 } from 'lucide-react';
import { useCallback, useContext, useState } from 'react';
import { useLocation } from 'react-router';
import { useArtifactOf } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { artifactTargetOf } from '../board/artifact/artifact-route.js';
import { PdfCover } from '../board/artifact/viewers/pdf-viewer.js';
import { attachmentUrl, OpenFileContext } from '../board/file-pane.js';
import { FileGlyph } from '../components/file-glyph.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { attachmentIdFromKey, isImageAttachmentKey } from './attachment-chip.js';

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

const MEDIA_FRAME =
  'block max-h-[min(28rem,60dvh)] max-w-full rounded-(--radius-tile) shadow-(--e1) bg-(--surface-1)';

export function isVideoAttachmentKey(key: string): boolean {
  return VIDEO_EXTS.has(attachmentExtOf(key));
}

function stripExt(name: string): string {
  const ext = attachmentExtOf(name);
  return ext === '' ? name : name.slice(0, -(ext.length + 1));
}

export function ArtifactAttachment({
  name,
  attachmentKey,
}: {
  name: string;
  attachmentKey: string;
}) {
  const { t } = useI18n();
  const openFile = useContext(OpenFileContext);
  const { search } = useLocation();
  const active = artifactTargetOf(new URLSearchParams(search))?.key === attachmentKey;
  const open = openFile === undefined ? undefined : () => openFile({ name, key: attachmentKey });
  const src = attachmentUrl(attachmentKey);
  if (isImageAttachmentKey(attachmentKey)) {
    return (
      <Button
        variant="ghost"
        data-testid="chat-artifact-image"
        aria-label={t('在面板打开 {name}', { name })}
        disabled={open === undefined}
        onClick={open}
        className="block h-auto max-w-full cursor-zoom-in rounded-(--radius-tile) p-0 hover:bg-transparent disabled:cursor-default disabled:opacity-100 dark:hover:bg-transparent"
      >
        <img src={src} alt={name} className={MEDIA_FRAME} />
      </Button>
    );
  }
  if (isVideoAttachmentKey(attachmentKey)) {
    return (
      <div data-testid="chat-artifact-video" className="relative w-fit max-w-full">
        <video
          src={`${src}#t=0.1`}
          controls
          playsInline
          preload="metadata"
          aria-label={name}
          className={MEDIA_FRAME}
        >
          <track kind="captions" />
        </video>
        {open !== undefined && (
          <IconTooltip
            label={t('在面板打开')}
            side="top"
            trigger={
              <Button
                variant="secondary"
                size="icon-sm"
                data-testid="chat-artifact-video-open"
                onClick={open}
                className="absolute top-2 right-2 shadow-(--e2)"
              />
            }
          >
            <Maximize2 aria-hidden className="size-4" />
          </IconTooltip>
        )}
      </div>
    );
  }
  return <ArtifactCard name={name} attachmentKey={attachmentKey} active={active} onOpen={open} />;
}

function ArtifactCard({
  name,
  attachmentKey,
  active,
  onOpen,
}: {
  name: string;
  attachmentKey: string;
  active: boolean;
  onOpen: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const { live } = useLiveData();
  const artifact = useArtifactOf(attachmentIdFromKey(attachmentKey), live).data;
  const ext = attachmentExtOf(attachmentKey).toUpperCase();
  const pdf = ext === 'PDF';
  const [pages, setPages] = useState<number | null>(null);
  const onPages = useCallback((n: number) => setPages(n), []);
  const meta = [
    t('文件 · {ext}', { ext }),
    pages === null ? '' : t('{n} 页', { n: pages }),
    artifact != null && artifact.versionSeq > 1 ? t('第 {n} 版', { n: artifact.versionSeq }) : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
  const body = (
    <>
      {pdf ? (
        <span className="flex h-20 w-14 flex-none items-start overflow-hidden rounded-(--radius-sm) bg-(--page-preview) shadow-(--e1)">
          <PdfCover src={attachmentUrl(attachmentKey)} width={56} onPages={onPages} />
        </span>
      ) : (
        <span className="flex size-8 flex-none items-center justify-center rounded-(--radius-control) bg-(--surface-1) shadow-(--e1)">
          <FileGlyph name={attachmentKey} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-card-title font-medium text-foreground">
          {stripExt(name)}
        </span>
        <span
          data-testid="chat-artifact-meta"
          className="truncate text-meta text-content-tertiary tabular-nums"
        >
          {meta}
        </span>
      </span>
    </>
  );
  const frame = cn(
    'flex w-128 max-w-full items-center gap-3 rounded-(--radius-card) bg-card px-4 text-left shadow-(--e1) transition-colors duration-(--dur-fast) ease-(--ease-standard)',
    pdf ? 'h-auto py-3' : 'h-16',
    active && 'shadow-[0_0_0_1px_var(--text-tertiary)]',
  );
  if (onOpen === undefined) {
    return (
      <a
        data-testid="chat-artifact-card"
        href={`${attachmentUrl(attachmentKey)}?download=1`}
        download={name}
        className={cn(frame, 'no-underline hover:bg-(--hover-1)')}
      >
        {body}
      </a>
    );
  }
  return (
    <Button
      variant="ghost"
      data-testid="chat-artifact-card"
      data-active={active || undefined}
      aria-label={t('打开 {name}', { name })}
      onClick={onOpen}
      className={cn(
        frame,
        'justify-start text-left font-normal whitespace-normal hover:bg-(--hover-1) dark:hover:bg-(--hover-1)',
      )}
    >
      {body}
    </Button>
  );
}
