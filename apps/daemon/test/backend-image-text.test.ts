import type { DescribableImage } from '@cairn/shared';
import type { Models } from '@earendil-works/pi-ai/models';
import { describe, expect, it } from 'vitest';
import { describeImageWithModels } from '../src/backend/image-text.js';

const image: DescribableImage = {
  data: Buffer.from('png').toString('base64'),
  mimeType: 'image/png',
  fileName: 'shot.png',
};

interface SeenCall {
  provider: string;
  id: string;
  hasImage: boolean;
}

function catalog(
  modelList: { provider: string; id: string; input?: string[]; costInput?: number }[],
  respond: (seen: SeenCall) => { stopReason?: string; text?: string } = () => ({
    text: 'described',
  }),
): { models: Pick<Models, 'getModels' | 'completeSimple'>; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  return {
    calls,
    models: {
      getModels: () =>
        modelList.map((m) => ({
          provider: m.provider,
          id: m.id,
          input: m.input ?? ['text'],
          cost: { input: m.costInput ?? 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      completeSimple: async (model: unknown, context: { messages: { content: unknown }[] }) => {
        const m = model as { provider: string; id: string };
        const content = context.messages.at(-1)?.content;
        calls.push({
          provider: m.provider,
          id: m.id,
          hasImage:
            Array.isArray(content) && content.some((b) => (b as { type: string }).type === 'image'),
        });
        const r = respond({ provider: m.provider, id: m.id, hasImage: true });
        return {
          stopReason: r.stopReason ?? 'stop',
          content: [{ type: 'text', text: r.text ?? 'described' }],
        };
      },
    } as unknown as Pick<Models, 'getModels' | 'completeSimple'>,
  };
}

describe('describeImageWithModels', () => {
  it('returns undefined when no image-capable model is registered', async () => {
    const { models } = catalog([{ provider: 'p', id: 't1' }]);
    expect(await describeImageWithModels(models, 'p', image)).toBeUndefined();
  });

  it('captions with an image-capable model and attributes it', async () => {
    const { models, calls } = catalog([{ provider: 'v', id: 'vm', input: ['text', 'image'] }]);
    const out = await describeImageWithModels(models, undefined, image);
    expect(out).toEqual({ text: 'described', attribution: 'v/vm' });
    expect(calls[0]?.hasImage).toBe(true);
  });

  it('prefers the driving provider over cheaper candidates', async () => {
    const { models, calls } = catalog([
      { provider: 'cheap', id: 'c1', input: ['text', 'image'], costInput: 0 },
      { provider: 'main', id: 'm1', input: ['text', 'image'], costInput: 5 },
    ]);
    const out = await describeImageWithModels(models, 'main', image);
    expect(out?.attribution).toBe('main/m1');
    expect(calls.map((c) => c.provider)).toEqual(['main']);
  });

  it('moves to the next candidate when a caption call fails', async () => {
    const { models, calls } = catalog(
      [
        { provider: 'a', id: 'a1', input: ['text', 'image'] },
        { provider: 'b', id: 'b1', input: ['text', 'image'] },
      ],
      (seen) => (seen.provider === 'a' ? { stopReason: 'error', text: '' } : { text: 'b said' }),
    );
    const out = await describeImageWithModels(models, undefined, image);
    expect(out).toEqual({ text: 'b said', attribution: 'b/b1' });
    expect(calls.map((c) => c.provider)).toEqual(['a', 'b']);
  });

  it('returns undefined when every candidate fails', async () => {
    const { models } = catalog([{ provider: 'v', id: 'vm', input: ['text', 'image'] }], () => ({
      stopReason: 'error',
      text: '',
    }));
    expect(await describeImageWithModels(models, undefined, image)).toBeUndefined();
  });
});
