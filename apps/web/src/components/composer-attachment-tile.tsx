import { cn } from 'cn';
import { Play } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';
import { FileGlyph } from './file-glyph.js';
import { IconTooltip } from './icon-tooltip.js';
import { AttachmentTrigger } from './ui/attachment.js';
import { Button } from './ui/button.js';

export interface ComposerAttachmentTileProps {
  name: string;
  state: 'ready' | 'uploading' | 'error';
  imageSrc?: string | undefined;
  videoSrc?: string | undefined;
  previewLines?: readonly string[] | undefined;
  previewProse?: boolean;
  errorReason?: string | undefined;
  href?: string | undefined;
  onPreview?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  interactive?: boolean;
  testId?: string | undefined;
}

const PILL_CLS =
  'mt-auto w-fit max-w-full truncate rounded-full px-1.5 text-caption leading-4 font-normal';

const TRIGGER_CLS =
  'cursor-pointer rounded-(--radius-tile) focus-visible:ring-2 focus-visible:ring-(--focus-ring)';

export function ComposerAttachmentTile({
  name,
  state,
  imageSrc,
  videoSrc,
  previewLines,
  previewProse = false,
  errorReason,
  href,
  onPreview,
  onRemove,
  interactive = false,
  testId,
}: ComposerAttachmentTileProps) {
  const { t } = useI18n();
  const uploading = state === 'uploading';
  const failed = state === 'error';
  const removeOnKey = (event: KeyboardEvent<HTMLElement>) => {
    if (onRemove === undefined) return;
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    onRemove();
  };
  const trigger =
    onPreview !== undefined ? (
      <AttachmentTrigger
        aria-label={name}
        title={name}
        className={TRIGGER_CLS}
        onClick={onPreview}
        onKeyDown={removeOnKey}
      />
    ) : href !== undefined ? (
      <AttachmentTrigger
        aria-label={name}
        title={name}
        render={<a href={href} target="_blank" rel="noopener noreferrer" />}
        className={TRIGGER_CLS}
        onKeyDown={removeOnKey}
      />
    ) : null;
  const removeLabel = t('移除附件：{name}', { name });
  return (
    <div
      data-testid={testId}
      data-state={state}
      data-slot="attachment-tile"
      title={trigger === null ? name : undefined}
      className={cn(
        'group/tile relative size-30.5 flex-none rounded-(--radius-tile) bg-background',
        uploading && 'animate-pulse bg-(--surface-tertiary) motion-reduce:animate-none',
        interactive && !uploading && 'hover:bg-(--surface-tertiary)',
      )}
    >
      {imageSrc !== undefined ? (
        <img
          src={imageSrc}
          alt={name}
          className={cn(
            'size-full rounded-(--radius-tile) object-cover',
            uploading && 'opacity-60',
          )}
        />
      ) : videoSrc !== undefined && !uploading && !failed ? (
        <>
          <video
            data-testid="attachment-tile-video"
            src={`${videoSrc}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none size-full rounded-(--radius-tile) bg-(--surface-tertiary) object-cover"
          >
            <track kind="captions" />
          </video>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 m-auto flex size-9 items-center justify-center rounded-full bg-(--lightbox-scrim) text-(--lightbox-ink)"
          >
            <Play className="size-4 fill-current" />
          </span>
        </>
      ) : (
        <div className="flex size-full min-w-0 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-2.5 pt-2.5">
            {failed ? (
              <span className={cn(PILL_CLS, 'mt-0 bg-(--danger-soft) text-destructive')}>
                {errorReason ?? t('上传失败')}
              </span>
            ) : previewLines !== undefined && previewLines.length > 0 && !uploading ? (
              <div
                data-testid="attachment-tile-preview"
                aria-hidden
                className={cn(
                  'w-[133.333%] min-w-0 origin-top-left scale-75 text-caption leading-4 text-content-secondary mask-b-from-40%',
                  !previewProse && 'font-mono',
                )}
              >
                {previewLines.map((line, index) => (
                  <p key={index} className="m-0 truncate">
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <span className="m-auto flex">
                <FileGlyph name={name} large />
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-none items-center gap-1.5 px-2.5 pt-1.5 pb-2.5">
            <FileGlyph name={name} />
            <span
              className={cn(
                'min-w-0 truncate text-caption',
                uploading ? 'text-content-tertiary' : 'text-foreground',
              )}
            >
              {name}
            </span>
          </div>
        </div>
      )}
      {uploading && <span className="sr-only">{t('上传中')}</span>}
      {failed && imageSrc !== undefined && (
        <span
          className={`${PILL_CLS} absolute bottom-2.5 left-2.5 bg-(--danger-soft) text-destructive`}
        >
          {errorReason ?? t('上传失败')}
        </span>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-(--radius-tile) inset-ring-1',
          failed
            ? 'inset-ring-destructive/55'
            : uploading
              ? 'inset-ring-transparent'
              : 'inset-ring-border',
        )}
      />
      {trigger}
      {onRemove !== undefined && (
        <IconTooltip
          label={removeLabel}
          trigger={
            <Button
              variant="ghost"
              size="icon-xs"
              data-slot="attachment-remove"
              className="absolute -top-2 -right-2 z-20 size-5 rounded-full bg-background text-content-secondary opacity-0 ring-1 ring-border hover:bg-background hover:text-foreground focus-visible:opacity-100 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-background [&_svg:not([class*='size-'])]:size-2.5"
              onClick={onRemove}
            />
          }
        >
          <X />
        </IconTooltip>
      )}
    </div>
  );
}
