import { useI18n } from '../i18n/provider.js';
import { X } from '../icons/index.js';
import { AttachmentTrigger } from './ui/attachment.js';
import { Button } from './ui/button.js';

export interface ComposerAttachmentTileProps {
  name: string;
  kind: string;
  state: 'ready' | 'uploading' | 'error';
  detail?: string | undefined;
  imageSrc?: string | undefined;
  progress?: number | undefined;
  errorReason?: string | undefined;
  href?: string | undefined;
  onPreview?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  testId?: string | undefined;
}

const PILL_CLS = 'mt-auto w-fit max-w-full truncate rounded-full px-1.5 text-caption font-medium';

export function ComposerAttachmentTile({
  name,
  kind,
  state,
  detail,
  imageSrc,
  progress,
  errorReason,
  href,
  onPreview,
  onRemove,
  testId,
}: ComposerAttachmentTileProps) {
  const { t } = useI18n();
  const uploading = state === 'uploading';
  const failed = state === 'error';
  const statusText = uploading
    ? progress != null
      ? t('上传中 {percent}%', { percent: progress })
      : t('上传中')
    : detail;
  const trigger =
    onPreview !== undefined ? (
      <AttachmentTrigger
        aria-label={name}
        title={name}
        className="cursor-pointer rounded-(--radius-tile) focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onPreview}
      />
    ) : href !== undefined ? (
      <AttachmentTrigger
        aria-label={name}
        title={name}
        render={<a href={href} target="_blank" rel="noopener noreferrer" />}
        className="rounded-(--radius-tile) focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    ) : null;
  return (
    <div
      data-testid={testId}
      data-state={state}
      className="group/tile relative size-28 flex-none rounded-(--radius-tile) bg-background"
    >
      {imageSrc !== undefined ? (
        <>
          <img
            src={imageSrc}
            alt={name}
            className={`size-full rounded-(--radius-tile) object-cover${uploading ? ' opacity-60' : ''}`}
          />
          {uploading && statusText !== undefined && (
            <span className="absolute bottom-5 left-2.5 rounded-full bg-background/85 px-1.5 text-caption tabular-nums text-foreground">
              {statusText}
            </span>
          )}
        </>
      ) : (
        <div className="flex size-full min-w-0 flex-col p-2.5">
          <span className="line-clamp-3 break-all text-meta text-foreground">{name}</span>
          {statusText !== undefined && (
            <span className="mt-0.5 truncate text-caption tabular-nums text-content-tertiary">
              {statusText}
            </span>
          )}
          {failed && errorReason !== undefined ? (
            <span className={`${PILL_CLS} bg-(--danger-soft) text-destructive`}>{errorReason}</span>
          ) : (
            !uploading && (
              <span className={`${PILL_CLS} text-content-secondary inset-ring-1 inset-ring-border`}>
                {kind}
              </span>
            )
          )}
        </div>
      )}
      {uploading && (
        <span
          aria-hidden="true"
          className="absolute inset-x-2.5 bottom-2.5 h-0.75 overflow-hidden rounded-full bg-secondary"
        >
          <span
            className={`block h-full rounded-full bg-foreground${progress == null ? ' w-1/3 animate-pulse' : ''}`}
            style={progress != null ? { width: `${progress}%` } : undefined}
          />
        </span>
      )}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-(--radius-tile) inset-ring-1 ${
          failed ? 'inset-ring-destructive/55' : 'inset-ring-border'
        }`}
      />
      {trigger}
      {onRemove !== undefined && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('移除附件')}
          className="absolute -top-1.5 -right-1.5 z-20 size-5 rounded-full bg-card text-content-secondary opacity-0 ring-1 ring-border hover:bg-card hover:text-foreground focus-visible:opacity-100 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-card [&_svg:not([class*='size-'])]:size-2.5"
          onClick={onRemove}
        >
          <X />
        </Button>
      )}
    </div>
  );
}
