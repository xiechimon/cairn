import { cn } from 'cn';
import { File, FileImage, FileText, FileVideoCamera, type LucideIcon } from 'lucide-react';
import { FileTypeIcon, resolveFileTypeIcon } from '../vendor-open-design/file-type-icon.js';
import { type FileViewerKind, kindFor } from '../vendor-open-design/viewers/file-kind.js';

const LUCIDE_GLYPH: Partial<Record<FileViewerKind, LucideIcon>> = {
  image: FileImage,
  svg: FileImage,
  video: FileVideoCamera,
  text: FileText,
  markdown: FileText,
};

export function FileGlyph({ name, large = false }: { name: string; large?: boolean }) {
  const vendor = resolveFileTypeIcon(name);
  if (vendor !== null)
    return <FileTypeIcon name={vendor} className={large ? 'size-8' : 'size-4'} />;
  const kind = kindFor(name);
  const Glyph = LUCIDE_GLYPH[kind] ?? File;
  return (
    <Glyph
      aria-hidden
      data-file-icon={kind}
      className={cn('flex-none', large ? 'size-5.5 text-content-tertiary' : 'size-4 text-icon')}
    />
  );
}
