import { useContext, useState } from 'react';
import { useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import { attachmentUrl, filePreviewKind, OpenFileContext } from '../board/file-pane.js';
import { ComposerAttachmentTile } from '../components/composer-attachment-tile.js';
import { attachmentIdFromKey } from '../detail/attachment-chip.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { type AttachmentToken, attachmentKind } from '../overlay/attachment-paste.js';
import { AttachmentPreview } from '../overlay/attachment-preview.js';

export function SentAttachments({ files }: { files: AttachmentToken[] }) {
  const openFile = useContext(OpenFileContext);
  const { live } = useLiveData();
  const { search } = useLocation();
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  const fixtures = live ? undefined : resolveScenario(new URLSearchParams(search)).attachments;
  return (
    <div
      data-testid="chief-sent-attachments"
      className="flex max-w-full flex-wrap justify-end gap-2"
    >
      {files.map((file, index) => {
        const src = fixtures?.[attachmentIdFromKey(file.key)]?.src ?? attachmentUrl(file.key);
        const image = filePreviewKind(file.key) === 'image';
        const open =
          openFile !== undefined
            ? { onPreview: () => openFile({ name: file.name, key: file.key }) }
            : image
              ? { onPreview: () => setPreview({ name: file.name, src }) }
              : { href: src };
        return (
          <ComposerAttachmentTile
            key={`${file.key}#${index}`}
            testId="chief-sent-attachment"
            name={file.name}
            kind={attachmentKind(file.name)}
            state="ready"
            interactive
            {...(image ? { imageSrc: src } : {})}
            {...open}
          />
        );
      })}
      {preview !== null && (
        <AttachmentPreview name={preview.name} src={preview.src} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
