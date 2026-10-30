import { useMemo, useState } from 'react';
import { attachmentIdFromKey } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { AttachmentCard } from './attachment-card.js';
import { type PendingAttachment, parseAttachmentTokens } from './attachment-paste.js';
import { AttachmentPreview } from './attachment-preview.js';

interface PreviewTarget {
  name: string;
  src: string;
}

export function AttachmentStrip({
  draft,
  pending,
}: {
  draft: string;
  pending: PendingAttachment[];
}) {
  const { t } = useI18n();
  const settled = useMemo(() => parseAttachmentTokens(draft), [draft]);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  if (pending.length === 0 && settled.length === 0) return null;
  return (
    <div
      className="attachment-strip flex flex-wrap gap-1.5 [&_.spec-chip-img]:min-h-10 [&_.spec-chip-img]:min-w-10"
      role="status"
      aria-label={t('附件')}
    >
      {pending.map((entry) => (
        <AttachmentCard
          key={entry.uid}
          name={entry.name}
          source={entry.url ?? ''}
          isImage={entry.url !== null}
          state="uploading"
          testId="attachment-pending"
          {...(entry.url !== null
            ? {
                onPreview: (n: string, src: string) => setPreview({ name: n, src }),
              }
            : {})}
        />
      ))}
      {settled.map((token, index) => (
        <AttachmentCard
          key={`${token.key}#${index}`}
          name={token.name}
          source={`/api/attachments/${encodeURIComponent(attachmentIdFromKey(token.key))}`}
          isImage={/\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(token.key)}
          state="done"
          onPreview={(n, src) => setPreview({ name: n, src })}
        />
      ))}
      {preview !== null && (
        <AttachmentPreview name={preview.name} src={preview.src} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
