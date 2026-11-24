import {
  COMPUTER_IMAGE_MAX_BASE64_CHARS,
  INLINE_IMAGE_MIME_BY_EXT,
  inlineImageMimeOfBytes,
} from '@cairn/shared';

const ALLOWED_IMAGE_MIMES: readonly string[] = Object.values(INLINE_IMAGE_MIME_BY_EXT);

export function hostToolContent(name: string, text: string) {
  const asText = [{ type: 'text' as const, text }];
  if (name !== 'attachment' && name !== 'read_file') return asText;
  let file: { mimeType?: unknown; encoding?: unknown; content?: unknown };
  try {
    file = JSON.parse(text);
  } catch {
    return asText;
  }
  if (
    typeof file.mimeType !== 'string' ||
    !ALLOWED_IMAGE_MIMES.includes(file.mimeType) ||
    file.encoding !== 'base64' ||
    typeof file.content !== 'string'
  ) {
    return asText;
  }
  if (file.content.length > COMPUTER_IMAGE_MAX_BASE64_CHARS) {
    return [
      {
        type: 'text' as const,
        text: `This image is too large to show here (${file.content.length} base64 characters).`,
      },
    ];
  }
  const bytes = Buffer.from(file.content, 'base64');
  if (bytes.length === 0 || inlineImageMimeOfBytes(bytes) !== file.mimeType) {
    return [{ type: 'text' as const, text: 'This attachment is not a readable image.' }];
  }
  return [
    {
      type: 'image' as const,
      data: file.content,
      mimeType: file.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
    },
  ];
}
