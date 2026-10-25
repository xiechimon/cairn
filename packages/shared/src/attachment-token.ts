export const ATTACHMENT_TOKEN_LINE = /^ {0,3}!\[([^\]\n]*)\]\(attachment:([^)\s]+)\)\s*$/;

const ATTACHMENT_KEY = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.([a-z0-9]{1,8})$/;

export interface AttachmentTokenRef {
  line: string;
  label: string;
  key: string;
  attachmentId: string;
  ext: string;
}

export function parseAttachmentTokenLines(text: string): AttachmentTokenRef[] {
  const refs: AttachmentTokenRef[] = [];
  for (const line of text.split('\n')) {
    const m = ATTACHMENT_TOKEN_LINE.exec(line);
    if (m === null) continue;
    const key = m[2] ?? '';
    const km = ATTACHMENT_KEY.exec(key);
    if (km === null) continue;
    refs.push({
      line,
      label: m[1] ?? '',
      key,
      attachmentId: km[2] ?? '',
      ext: km[3] ?? '',
    });
  }
  return refs;
}

export function formatAttachmentToken(fileName: string, key: string): string {
  return `![${fileName}](attachment:${key})`;
}

const INLINE_ATTACHMENT_TOKEN = /!\[([^\]\n]*)\]\(attachment:[^)\s]+\)/g;

export function renderAttachmentTokensToLabels(text: string): string {
  return text.replace(INLINE_ATTACHMENT_TOKEN, (_, label: string) => label);
}

export const INLINE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

export const INLINE_IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const IMAGE_ATTACHMENT_EXTS = [...INLINE_IMAGE_EXTS, 'svg', 'bmp', 'ico', 'avif'] as const;

export function isImageAttachmentExt(ext: string): boolean {
  return (IMAGE_ATTACHMENT_EXTS as readonly string[]).includes(ext);
}
