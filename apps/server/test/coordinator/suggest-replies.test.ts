import { createServer } from 'node:http';
import { zstdDecompressSync } from 'node:zlib';
import { fauxAssistantMessage, fauxProvider, type Message } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import {
  repliesFromModelText,
  requestSuggestedReplies,
} from '../../src/coordinator/runtime/suggest-replies.js';

it.each([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'openai-codex-responses',
] as const)('sends one small %s request and never retries a provider error', async (api) => {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const decoded =
      request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(body) : body;
    requests.push(JSON.parse(decoded.toString('utf8')));
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'temporarily unavailable' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No test server port');
    const coordinator = createCoordinatorModels();
    const subscription = api === 'openai-codex-responses';
    const providerId = subscription ? 'openai-codex' : 'wire';
    const baseUrl = `http://127.0.0.1:${address.port}`;
    coordinator.useStepProvider({
      kind: 'http',
      providerId,
      baseUrl: subscription ? undefined : baseUrl,
      api: subscription ? undefined : api,
      models: [{ id: 'm', name: 'm' }],
    });
    const model = coordinator.models.getModel(providerId, 'm');
    if (model === undefined) throw new Error('Missing model');
    model.baseUrl = baseUrl;
    const claims = Buffer.from(
      JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test' } }),
    ).toString('base64url');
    await coordinator.setApiKey(providerId, `test.${claims}.test`);
    const result = await requestSuggestedReplies(
      coordinator.models,
      { provider: providerId, modelId: 'm' },
      [{ role: 'user', content: 'Explain caching.', timestamp: 1 }],
    );
    expect(result?.replies).toEqual([]);
    expect(requests).toHaveLength(1);
    const body = requests[0]!;
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(16_384);
    const maxOutput = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
    expect(maxOutput).toBe(api === 'openai-codex-responses' ? undefined : 256);
    if (subscription) expect(body.reasoning).toEqual({ effort: 'low', summary: 'auto' });
    expect(body.tools ?? []).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

it('blocks an oversized serialized payload before network dispatch', async () => {
  const modelId = 'm'.repeat(16_384);
  const coordinator = createCoordinatorModels();
  coordinator.useStepProvider({
    kind: 'http',
    providerId: 'wire',
    baseUrl: 'http://127.0.0.1:9',
    api: 'openai-completions',
    models: [{ id: modelId, name: 'm' }],
  });
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected dispatch'));
  try {
    const result = await requestSuggestedReplies(
      coordinator.models,
      { provider: 'wire', modelId },
      [{ role: 'user', content: 'Explain caching.', timestamp: 1 }],
    );
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

it.each(['字', '😀', '\u0001'])(
  'uses only the latest four text messages, bounded independently of history (%#)',
  async (character) => {
    const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
    const requests: Message[][] = [];
    faux.setResponses([
      (context: { messages: Message[] }) => {
        requests.push(context.messages);
        return fauxAssistantMessage('{"replies":["举个例子","比较两种方案"]}');
      },
    ]);
    const { models } = createCoordinatorModels([faux.provider]);
    const messages: Message[] = [
      { role: 'system', content: 'PRIVATE-SYSTEM'.repeat(10_000), timestamp: 1 },
      { role: 'user', content: 'OLD-QUESTION'.repeat(10_000), timestamp: 1 },
      fauxAssistantMessage('OLD-ANSWER'.repeat(10_000)),
      { role: 'user', content: 'previous question', timestamp: 1 },
      fauxAssistantMessage('previous answer'),
      {
        role: 'user',
        content: [
          { type: 'text', text: `START${character.repeat(10_000)}END` },
          { type: 'image', data: 'PRIVATE-IMAGE'.repeat(10_000), mimeType: 'image/png' },
        ],
        timestamp: 1,
      },
      fauxAssistantMessage([{ type: 'thinking', thinking: 'PRIVATE-THINKING' }], {
        stopReason: 'toolUse',
      }),
      {
        role: 'toolResult',
        toolCallId: 'call',
        toolName: 'private-tool',
        content: [{ type: 'text', text: 'PRIVATE-RESULT'.repeat(10_000) }],
        isError: false,
        timestamp: 1,
      },
      fauxAssistantMessage(`LATEST${character.repeat(10_000)}NEXT-STEP`),
    ];
    const original = structuredClone(messages);
    const result = await requestSuggestedReplies(
      models,
      { provider: 'stub', modelId: 'm' },
      messages,
    );
    expect(result?.replies).toEqual(['举个例子', '比较两种方案']);
    expect(messages).toEqual(original);
    expect(requests).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(requests[0]))).toBeLessThanOrEqual(16_384);
    const data = requests[0]?.at(-1)?.content;
    expect(typeof data).toBe('string');
    const conversation = JSON.parse(data as string).conversation as {
      role: string;
      content: string;
    }[];
    expect(conversation).toEqual([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: `START${character.repeat(245)}…${character.repeat(246)}END` },
      {
        role: 'assistant',
        content: `LATEST${character.repeat(244)}…${character.repeat(240)}NEXT-STEP`,
      },
    ]);
    expect(conversation.every((message) => [...message.content].length <= 500)).toBe(true);
    expect(JSON.stringify(requests)).not.toMatch(/PRIVATE-|OLD-/);
  },
);

it('does not dispatch an image-only context', async () => {
  const faux = fauxProvider({ provider: 'stub', models: [{ id: 'm', contextWindow: 200_000 }] });
  const { models } = createCoordinatorModels([faux.provider]);
  const result = await requestSuggestedReplies(models, { provider: 'stub', modelId: 'm' }, [
    {
      role: 'user',
      content: [{ type: 'image', data: 'aA==', mimeType: 'image/png' }],
      timestamp: 1,
    },
  ]);
  expect(result).toBeNull();
  expect(faux.state.callCount).toBe(0);
});

describe('repliesFromModelText', () => {
  it('reads the JSON object out of surrounding text', () => {
    expect(repliesFromModelText('好的\n{"replies":["继续看 README","先做个计划"]}\n')).toEqual([
      '继续看 README',
      '先做个计划',
    ]);
  });

  it.each([1, 2, 3])('keeps %i distinct predictions without padding the set', (count) => {
    const replies = ['举个例子', '解释缓存失效', '比较两种方案'].slice(0, count);
    expect(repliesFromModelText(JSON.stringify({ replies }))).toEqual(replies);
  });

  it('keeps short predictions without cutting a long instruction', () => {
    expect(
      repliesFromModelText(JSON.stringify({ replies: ['字'.repeat(33), '举个例子', '继续解释'] })),
    ).toEqual(['举个例子', '继续解释']);
    expect(repliesFromModelText(JSON.stringify({ replies: ['字'.repeat(32)] }))).toEqual([
      '字'.repeat(32),
    ]);
    expect(repliesFromModelText(JSON.stringify({ replies: ['字'.repeat(33)] }))).toEqual([]);
  });

  it('drops a reply that confirms an irreversible action', () => {
    expect(repliesFromModelText('{"replies":["继续","删除这个项目"]}')).toEqual(['继续']);
  });

  it('returns nothing for an empty set, prose, or broken JSON', () => {
    expect(repliesFromModelText('{"replies":[]}')).toEqual([]);
    expect(repliesFromModelText('nothing to suggest')).toEqual([]);
    expect(repliesFromModelText('{"replies":')).toEqual([]);
  });
});
