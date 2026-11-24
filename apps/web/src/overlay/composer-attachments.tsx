import { useMemo, useRef } from 'react';
import { FileTile } from '../board/file-tile.js';
import { ComposerAttachmentTile } from '../components/composer-attachment-tile.js';
import type { ComposerFileSeed } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { type PendingAttachment, parseAttachmentTokens } from './attachment-paste.js';

export function ComposerAttachments({
  tokens,
  pending,
  onRemove,
  onDismissPending,
  seeded = [],
  onDismissSeeded,
}: {
  tokens: string[];
  pending: PendingAttachment[];
  onRemove: (index: number) => void;
  onDismissPending?: (uid: string) => void;
  seeded?: ComposerFileSeed[];
  onDismissSeeded?: (index: number) => void;
}) {
  const { t } = useI18n();
  const settled = useMemo(() => parseAttachmentTokens(tokens.join('\n')), [tokens]);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const thenFocusInput = (remove: () => void) => () => {
    const host = stripRef.current?.parentElement ?? null;
    remove();
    requestAnimationFrame(() => host?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
  };
  if (pending.length === 0 && settled.length === 0 && seeded.length === 0) return null;
  return (
    <div
      ref={stripRef}
      data-testid="composer-attachments"
      className="flex max-h-64 flex-wrap gap-2 overflow-y-auto pt-2 pr-2 pb-2.5"
      role="status"
      aria-label={t('附件')}
    >
      {seeded.map((entry, index) => (
        <ComposerAttachmentTile
          key={`seed-${entry.name}`}
          {...(entry.state === 'ready' ? {} : { testId: 'attachment-pending' })}
          name={entry.name}
          state={entry.state}
          {...(entry.state !== 'uploading' && onDismissSeeded !== undefined
            ? { onRemove: thenFocusInput(() => onDismissSeeded(index)) }
            : {})}
        />
      ))}
      {pending.map((entry) => (
        <ComposerAttachmentTile
          key={entry.uid}
          testId="attachment-pending"
          name={entry.name}
          state={entry.failed ? 'error' : 'uploading'}
          {...(entry.url !== null ? { imageSrc: entry.url } : {})}
          {...(entry.failed && onDismissPending !== undefined
            ? { onRemove: thenFocusInput(() => onDismissPending(entry.uid)) }
            : {})}
        />
      ))}
      {settled.map((token, index) => (
        <FileTile
          key={`${token.key}#${index}`}
          file={token}
          onRemove={thenFocusInput(() => onRemove(index))}
        />
      ))}
    </div>
  );
}
