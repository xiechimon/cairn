import { COMPUTER_IMAGE_MAX_BASE64_CHARS } from '@cairn/shared';

const IMAGE_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

export function hostToolContent(name: string, text: string) {
  const asText = [{ type: 'text' as const, text }];
  if (name !== 'attachment') return asText;
  let file: { mimeType?: unknown; encoding?: unknown; content?: unknown };
  try {
    file = JSON.parse(text);
  } catch {
    return asText;
  }
  if (
    typeof file.mimeType !== 'string' ||
    IMAGE_SIGNATURES[file.mimeType] === undefined ||
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
  if (bytes.length === 0 || !IMAGE_SIGNATURES[file.mimeType]?.(bytes)) {
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
