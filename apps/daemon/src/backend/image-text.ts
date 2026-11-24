import {
  type DescribableImage,
  extractCaptionReplyText,
  IMAGE_CAPTION_ASK,
  IMAGE_CAPTION_MAX_TOKENS,
  IMAGE_CAPTION_TIMEOUT_MS,
  type ImageDescription,
  rankImageCaptionModels,
} from '@cairn/shared';
import type { Message } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';

export { IMAGE_CAPTION_ASK };

export async function describeImageWithModels(
  models: Pick<Models, 'getModels' | 'completeSimple'>,
  preferProvider: string | undefined,
  image: DescribableImage,
  signal?: AbortSignal,
): Promise<ImageDescription | undefined> {
  const candidates = rankImageCaptionModels(models.getModels(), preferProvider);
  if (candidates.length === 0) return undefined;
  const messages: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: IMAGE_CAPTION_ASK },
        { type: 'image', data: image.data, mimeType: image.mimeType },
      ],
      timestamp: Date.now(),
    },
  ];
  for (const model of candidates) {
    try {
      const reply = await models.completeSimple(
        model,
        { messages },
        {
          toolChoice: 'none',
          maxTokens: IMAGE_CAPTION_MAX_TOKENS,
          timeoutMs: IMAGE_CAPTION_TIMEOUT_MS,
          signal,
        },
      );
      const text = extractCaptionReplyText(reply);
      if (text !== null) {
        return { text, attribution: `${model.provider}/${model.id}` };
      }
    } catch {}
  }
  return undefined;
}
