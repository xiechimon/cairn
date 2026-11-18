import type { DescribableImage, ImageDescription } from '@cairn/shared';
import type { Message } from '@earendil-works/pi-ai';
import type { Models } from '@earendil-works/pi-ai/models';

const CAPTION_TIMEOUT_MS = 45_000;
const CAPTION_MAX_TOKENS = 1200;
const CAPTION_CANDIDATE_LIMIT = 3;

export const IMAGE_CAPTION_ASK =
  'Transcribe all visible text verbatim, then briefly describe the image for an agent that cannot see it.';

export async function describeImageWithModels(
  models: Pick<Models, 'getModels' | 'completeSimple'>,
  preferProvider: string | undefined,
  image: DescribableImage,
  signal?: AbortSignal,
): Promise<ImageDescription | undefined> {
  const candidates = models
    .getModels()
    .filter((model) => model.input.includes('image'))
    .sort(
      (a, b) =>
        Number(b.provider === preferProvider) - Number(a.provider === preferProvider) ||
        a.cost.input - b.cost.input ||
        a.id.localeCompare(b.id),
    )
    .slice(0, CAPTION_CANDIDATE_LIMIT);
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
          maxTokens: CAPTION_MAX_TOKENS,
          timeoutMs: CAPTION_TIMEOUT_MS,
          signal,
        },
      );
      const text = reply.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      if (reply.stopReason === 'stop' && text !== '') {
        return { text, attribution: `${model.provider}/${model.id}` };
      }
    } catch {}
  }
  return undefined;
}
