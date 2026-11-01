import { useMemo, useState } from 'react';
import { ComposerAttachmentTile } from '../components/composer-attachment-tile.js';
import { attachmentIdFromKey } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import {
  formatFileSize,
  type PendingAttachment,
  parseAttachmentTokens,
  removeAttachmentToken,
} from './attachment-paste.js';
import { AttachmentPreview } from './attachment-preview.js';

interface PreviewTarget {
  name: string;
  src: string;
}

const IMAGE_KEY = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

function fileKind(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : 'FILE';
}

export function ComposerAttachments({
  draft,
  pending,
  onDraftChange,
}: {
  draft: string;
  pending: PendingAttachment[];
  onDraftChange: (next: string) => void;
}) {
  const { t } = useI18n();
  const settled = useMemo(() => parseAttachmentTokens(draft), [draft]);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  if (pending.length === 0 && settled.length === 0) return null;
  return (
    <div
      data-testid="composer-attachments"
      className="flex flex-wrap gap-2 pt-1.5 pb-2.5"
      role="status"
      aria-label={t('附件')}
    >
      {pending.map((entry) => (
        <ComposerAttachmentTile
          key={entry.uid}
          testId="attachment-pending"
          name={entry.name}
          kind={fileKind(entry.name)}
          state="uploading"
          detail={formatFileSize(entry.size)}
          {...(entry.url !== null
            ? {
                imageSrc: entry.url,
                onPreview: () => setPreview({ name: entry.name, src: entry.url ?? '' }),
              }
            : {})}
        />
      ))}
      {settled.map((token, index) => {
        const source = `/api/attachments/${encodeURIComponent(attachmentIdFromKey(token.key))}`;
        const isImage = IMAGE_KEY.test(token.key);
        return (
          <ComposerAttachmentTile
            key={`${token.key}#${index}`}
            name={token.name}
            kind={fileKind(token.name)}
            state="ready"
            onRemove={() => onDraftChange(removeAttachmentToken(draft, index))}
            {...(isImage
              ? {
                  imageSrc: source,
                  onPreview: () => setPreview({ name: token.name, src: source }),
                }
              : { href: source })}
          />
        );
      })}
      {preview !== null && (
        <AttachmentPreview name={preview.name} src={preview.src} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
