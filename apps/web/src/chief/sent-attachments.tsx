import { FileTile } from '../board/file-tile.js';
import type { AttachmentToken } from '../overlay/attachment-paste.js';

export function SentAttachments({ files }: { files: AttachmentToken[] }) {
  return (
    <div
      data-testid="chief-sent-attachments"
      className="flex max-w-full flex-wrap justify-end gap-2"
    >
      {files.map((file, index) => (
        <FileTile
          key={`${file.key}#${index}`}
          testId="chief-sent-attachment"
          file={file}
          set={files}
        />
      ))}
    </div>
  );
}
