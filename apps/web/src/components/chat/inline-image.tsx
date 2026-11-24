import { cn } from 'cn';
import { ImageOff, RotateCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useAttachmentFiles } from '../../board/file-data.js';
import { useI18n } from '../../i18n/provider.js';
import { humanSize } from '../../vendor-open-design/viewers/binary-viewer.js';
import { Button } from '../ui/button.js';

type Shown =
  | { kind: 'loading' }
  | { kind: 'ok'; width: number; height: number }
  | { kind: 'broken' };

const FRAME_CLS =
  'relative block max-w-full cursor-zoom-in overflow-hidden rounded-(--radius-card) bg-(--page-preview) p-0 ring-1 ring-border focus-visible:outline-offset-3';
const SKELETON_CLS = 'animate-pulse rounded-(--radius-card) bg-(--secondary)';

function retried(src: string, attempt: number): string {
  if (attempt === 0 || src.startsWith('data:')) return src;
  return `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`;
}

export function InlineImage({
  name,
  attachmentKey,
  onOpen,
  paired = false,
}: {
  name: string;
  attachmentKey: string;
  onOpen?: (() => void) | undefined;
  paired?: boolean;
}) {
  const { t } = useI18n();
  const files = useAttachmentFiles(attachmentKey, { size: !paired });
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  if (shown.kind === 'broken')
    return (
      <div
        className="inline-flex max-w-full items-center gap-3 rounded-(--radius-card) bg-card py-2.5 pr-2.5 pl-3 ring-1 ring-border"
        data-testid="inline-image-broken"
      >
        <span className="grid size-9 flex-none place-items-center rounded-lg bg-(--secondary) text-(--text-tertiary)">
          <ImageOff className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 font-sans">
          <span className="block truncate text-ui text-(--foreground)">{name}</span>
          <span className="block text-meta text-(--text-tertiary)">{t('图片没能加载出来')}</span>
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="flex-none font-sans"
          data-testid="inline-image-retry"
          onClick={() => {
            setShown({ kind: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCw strokeWidth={1.75} aria-hidden />
          {t('重试')}
        </Button>
      </div>
    );
  const loading = shown.kind === 'loading';
  const image = (
    <img
      key={attempt}
      src={retried(files.src, attempt)}
      alt={name}
      className={cn(
        'block max-w-full object-contain',
        paired ? 'w-full' : 'h-auto max-h-105 w-auto',
        loading && 'absolute inset-0 opacity-0',
      )}
      onLoad={(event) =>
        setShown({
          kind: 'ok',
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        })
      }
      onError={() => setShown({ kind: 'broken' })}
    />
  );
  const skeleton = loading && (
    <span
      className={cn(
        SKELETON_CLS,
        'block',
        paired ? 'aspect-[3/4] w-full' : 'aspect-[4/3] w-80 max-w-full',
      )}
      role="img"
      aria-label={t('{name} 正在加载', { name })}
      data-testid="inline-image-loading"
    />
  );
  return (
    <figure
      className="m-0 max-w-[min(100%,var(--container-reply))] font-sans"
      data-testid="inline-image"
    >
      {onOpen === undefined ? (
        <span className={cn(FRAME_CLS, 'cursor-default', !paired && 'inline-block align-top')}>
          {skeleton}
          {image}
        </span>
      ) : (
        <Button
          variant="ghost"
          className={cn(
            FRAME_CLS,
            'h-auto border-0 hover:bg-(--page-preview) dark:hover:bg-(--page-preview)',
            !paired && 'inline-block align-top',
            loading && 'ring-0',
          )}
          aria-label={t('查看大图：{name}', { name })}
          onClick={onOpen}
        >
          {skeleton}
          {image}
        </Button>
      )}
      <figcaption className="mt-2 flex flex-wrap gap-x-2 text-meta text-(--text-tertiary) tabular-nums">
        <span className="min-w-0 truncate font-medium text-(--text-secondary)">{name}</span>
        {!paired && shown.kind === 'ok' && (
          <span>
            {shown.width.toLocaleString()} × {shown.height.toLocaleString()}
          </span>
        )}
        {!paired && files.size !== undefined && <span>{humanSize(files.size)}</span>}
      </figcaption>
    </figure>
  );
}

export function InlineImagePair({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid max-w-[min(100%,var(--container-reply))] grid-cols-2 gap-2"
      data-testid="inline-image-pair"
    >
      {children}
    </div>
  );
}
