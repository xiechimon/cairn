import { readFileSync } from 'node:fs';
import { createRequire as createImageRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { INLINE_IMAGE_MIME_BY_EXT } from '@cairn/shared';
import type { ImageContent, Message } from '@earendil-works/pi-ai';
import { createPhotonImages } from '@earendil-works/pi-durable/images';
import { DEFAULT_IMAGE_LIMITS, type ImageProcessor } from '@earendil-works/pi-durable/tools';
import { BUNDLED_FORM } from '../../bundle-form.js';

const inlineMimeTypes = new Set(Object.values(INLINE_IMAGE_MIME_BY_EXT));
let processor: ImageProcessor | undefined;

export async function prepareCoordinatorImage(
  data: string,
  mimeType: string,
): Promise<ImageContent> {
  if (processor === undefined) {
    const wasmPath = BUNDLED_FORM
      ? fileURLToPath(new URL('./photon_rs_bg.wasm', import.meta.url))
      : createImageRequire(
          createImageRequire(import.meta.url).resolve('@earendil-works/pi-durable/images'),
        ).resolve('@silvia-odwyer/photon/photon_rs_bg.wasm');
    processor = createPhotonImages(readFileSync(wasmPath));
  }
  const image = await processor.prepare(
    Buffer.from(data, 'base64'),
    mimeType,
    DEFAULT_IMAGE_LIMITS,
  );
  if (image === undefined) {
    throw new Error('attachment image: cannot decode or resize to provider image limits');
  }
  return { type: 'image', data: image.data, mimeType: image.mimeType };
}

export function boundCoordinatorImages(messages: readonly Message[]): Message[] {
  let bytesLeft = DEFAULT_IMAGE_LIMITS.maxBytes;
  let imagesLeft = 20;
  return messages
    .toReversed()
    .map((message): Message => {
      if (message.role !== 'user' && message.role !== 'toolResult') return message;
      if (typeof message.content === 'string') return message;
      const content = message.content
        .toReversed()
        .map((block) => {
          if (block.type !== 'image') return block;
          if (
            !inlineMimeTypes.has(block.mimeType) ||
            block.data.length > bytesLeft ||
            imagesLeft === 0
          ) {
            return {
              type: 'text' as const,
              text: '[Image omitted from this request to stay within provider limits; use attachment to read it again.]',
            };
          }
          bytesLeft -= block.data.length;
          imagesLeft--;
          return block;
        })
        .reverse();
      return { ...message, content };
    })
    .reverse();
}
