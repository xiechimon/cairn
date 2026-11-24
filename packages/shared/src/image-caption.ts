export const IMAGE_CAPTION_TIMEOUT_MS = 45_000;
export const IMAGE_CAPTION_MAX_TOKENS = 1200;
export const IMAGE_CAPTION_CANDIDATE_LIMIT = 3;

export const IMAGE_CAPTION_ASK =
  'Transcribe all visible text verbatim, then briefly describe the image for an agent that cannot see it.';

export interface ImageCaptionModelLike {
  id: string;
  provider: string;
  input: readonly string[];
  cost: { input: number };
}

export function rankImageCaptionModels<M extends ImageCaptionModelLike>(
  models: readonly M[],
  preferProvider: string | undefined,
): M[] {
  return models
    .filter((model) => model.input.includes('image'))
    .sort(
      (a, b) =>
        Number(b.provider === preferProvider) - Number(a.provider === preferProvider) ||
        a.cost.input - b.cost.input ||
        a.id.localeCompare(b.id),
    )
    .slice(0, IMAGE_CAPTION_CANDIDATE_LIMIT);
}

export function extractCaptionReplyText(reply: {
  stopReason: string;
  content: readonly { type: string; text?: string }[];
}): string | null {
  if (reply.stopReason !== 'stop') return null;
  const text = reply.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('')
    .trim();
  return text === '' ? null : text;
}
