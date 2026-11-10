import { INLINE_IMAGE_EXTS } from '@cairn/shared';
import { createContext } from 'react';
import { Button } from '../components/ui/button.js';

export function attachmentIdFromKey(key: string): string {
  const lastSlash = key.lastIndexOf('/');
  const tail = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(0, dot) : tail;
}

export function isImageAttachmentKey(key: string): boolean {
  const dot = key.lastIndexOf('.');
  if (dot < 0 || dot === key.length - 1) return false;
  return (INLINE_IMAGE_EXTS as readonly string[]).includes(key.slice(dot + 1).toLowerCase());
}

export const SPEC_CHIP =
  'inline-flex max-w-full items-center rounded-(--cds-radius-md) border border-(--border) bg-(--muted) px-2 py-1 font-sans font-normal text-meta text-(--text-secondary) no-underline transition-[color,border-color] duration-(--dur-fast) ease-(--ease-standard) hover:border-(--input) hover:text-(--foreground)';
export const SPEC_CHIP_IMAGE =
  'border-none bg-transparent p-0.5 hover:bg-transparent dark:hover:bg-transparent';
export const SPEC_CHIP_IMG = 'block max-h-40 max-w-full rounded-(--cds-radius-sm)';

export const COMPOSER_CHIP_LABEL = 'block min-w-0 max-w-65 truncate';

export const AttachmentPreviewHandler = createContext<
  ((name: string, src: string) => void) | undefined
>(undefined);

export function AttachmentChip({
  name,
  attachmentKey,
  onPreview,
}: {
  name: string;
  attachmentKey: string;
  onPreview?: (name: string, src: string) => void;
}) {
  const href = `/api/attachments/${encodeURIComponent(attachmentIdFromKey(attachmentKey))}`;
  const isImage = isImageAttachmentKey(attachmentKey);
  if (isImage && onPreview !== undefined) {
    return (
      <Button
        variant="ghost"
        className={`spec-chip spec-chip--image ${SPEC_CHIP} ${SPEC_CHIP_IMAGE} h-auto cursor-pointer rounded-(--cds-radius-md) whitespace-normal font-normal [&_svg:not([class*='size-'])]:size-auto`}
        title={name}
        nativeButton={false}
        render={<a href={href} />}
        onClick={(event) => {
          event.preventDefault();
          onPreview(name, href);
        }}
      >
        <img src={href} alt={name} className={`spec-chip-img ${SPEC_CHIP_IMG}`} />
      </Button>
    );
  }
  if (isImage) {
    return (
      <a
        className={`spec-chip spec-chip--image ${SPEC_CHIP} ${SPEC_CHIP_IMAGE}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={name}
      >
        <img src={href} alt={name} className={`spec-chip-img ${SPEC_CHIP_IMG}`} />
      </a>
    );
  }
  return (
    <a
      className={`spec-chip ${SPEC_CHIP}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={name}
    >
      {name}
    </a>
  );
}
