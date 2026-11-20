import { useContext } from 'react';
import { ComposerAttachmentTile } from '../components/composer-attachment-tile.js';
import { useAttachmentFiles, useFilePreviewLines } from './file-data.js';
import { type FileTarget, OpenFileContext } from './file-pane.js';

export function FileTile({
  file,
  set,
  testId,
  onRemove,
}: {
  file: FileTarget;
  set: readonly FileTarget[];
  testId?: string;
  onRemove?: () => void;
}) {
  const openFile = useContext(OpenFileContext);
  const { kind, src } = useAttachmentFiles(file.key, { tile: true });
  const previewLines = useFilePreviewLines(file.key);
  return (
    <ComposerAttachmentTile
      testId={testId}
      name={file.name}
      state="ready"
      interactive
      {...(kind === 'image' || kind === 'svg' ? { imageSrc: src } : {})}
      {...(kind === 'video' ? { videoSrc: src } : {})}
      previewLines={previewLines}
      previewProse={kind === 'document' && !file.key.endsWith('.xlsx')}
      {...(onRemove !== undefined ? { onRemove } : {})}
      {...(openFile !== undefined ? { onPreview: () => openFile(file, set) } : { href: src })}
    />
  );
}
