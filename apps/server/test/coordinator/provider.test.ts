import { zstdDecompressSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';
import { inServerThinking, piThinking } from '../../src/coordinator/runtime/provider.js';

const config = {
  kind: 'http' as const,
  providerId: 'anthropic-byok',
  label: 'Anthropic (team key)',
  baseUrl: 'https://api.anthropic.com',
  api: 'anthropic-messages' as const,
  models: [
    { id: 'claude-haiku-5-5', name: 'Haiku 5.5', contextWindow: 1_000_000, maxTokens: 64_000 },
  ],
};

const previous = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previous;
});

describe('the provider of a claimed Coordinator step', () => {
  it('registers the team provider id with its models and window', () => {
    const models = createCoordinatorModels();
    expect(models.models.getModel('anthropic-byok', 'claude-haiku-5-5')).toBeUndefined();
    models.useStepProvider(config);
    expect(models.models.getModel('anthropic-byok', 'claude-haiku-5-5')).toMatchObject({
      api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
      contextWindow: 1_000_000,
      maxTokens: 64_000,
    });
  });

  it.each([
    { id: 'claude-sonnet-5-5', input: undefined, expected: ['text', 'image'] },
    { id: 'gateway-private-model', input: undefined, expected: ['text'] },
    { id: 'claude-sonnet-5-5', input: ['text'] as ('text' | 'image')[], expected: ['text'] },
    {
      id: 'gateway-private-model',
      input: ['text', 'image'] as ('text' | 'image')[],
      expected: ['text', 'image'],
    },
  ])(
    'resolves image input from the saved model, else the preset catalog, else text-only: $id $input',
    ({ id, input, expected }) => {
      const models = createCoordinatorModels();
      models.useStepProvider({ ...config, models: [{ id, name: id, input }] });
      expect(models.models.getModel(config.providerId, id)?.input).toEqual(expected);
    },
  );

  it('authenticates only with the key handed over for the step, never the process environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-env';
    const models = createCoordinatorModels();
    models.useStepProvider(config);
    expect(JSON.stringify(await models.models.getAuth('anthropic-byok'))).not.toContain(
      'sk-from-env',
    );
    await models.setApiKey('anthropic-byok', 'sk-step');
    expect(JSON.stringify(await models.models.getAuth('anthropic-byok'))).toContain('sk-step');
    expect(JSON.stringify(await models.models.getAuth('anthropic-byok'))).not.toContain(
      'sk-from-env',
    );
  });

  it('skips a provider whose API it cannot speak', () => {
    const models = createCoordinatorModels();
    models.useStepProvider({ kind: 'api_key', providerId: 'claude-code' });
    expect(models.models.getProviders()).toHaveLength(0);
  });

  it('registers catalog reasoning, level map and compat on a non-Codex builtin provider', () => {
    const models = createCoordinatorModels();
    models.useStepProvider({
      ...config,
      providerId: 'anthropic',
      models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }],
    });
    expect(models.models.getModel('anthropic', 'claude-opus-5-5')).toMatchObject({
      reasoning: true,
      thinkingLevelMap: expect.objectContaining({ off: null, xhigh: 'xhigh', max: 'max' }),
      compat: expect.objectContaining({
        forceAdaptiveThinking: true,
        supportsMidConvoEffort: true,
      }),
    });
  });

  it('does not borrow catalog flags when the row speaks another api', () => {
    const models = createCoordinatorModels();
    models.useStepProvider({
      ...config,
      api: 'openai-completions',
      providerId: 'anthropic',
      models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5' }],
    });
    expect(models.models.getModel('anthropic', 'claude-opus-5-5')).toMatchObject({
      reasoning: false,
      thinkingLevelMap: undefined,
    });
  });

  it.each([
    {
      provider: {
        kind: 'http' as const,
        providerId: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages' as const,
        models: [{ id: 'claude-fable-5', name: 'Fable 5' }],
      },
      modelId: 'claude-fable-5',
      expectBody: (body: Record<string, unknown>) => {
        expect(body.thinking).toMatchObject({ type: 'adaptive' });
        expect(body.output_config).toEqual({ effort: 'high' });
      },
    },
    {
      provider: {
        kind: 'http' as const,
        providerId: 'z-ai',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        api: 'openai-completions' as const,
        models: [{ id: 'glm-5.3', name: 'GLM 5.3' }],
      },
      modelId: 'glm-5.3',
      expectBody: (body: Record<string, unknown>) => {
        expect(body.thinking).toMatchObject({ type: 'enabled' });
        expect(body.reasoning_effort).toBe('high');
      },
    },
  ])(
    'sends the chosen thinking level on the wire for $provider.providerId/$modelId',
    async ({ provider, modelId, expectBody }) => {
      const models = createCoordinatorModels();
      models.useStepProvider(provider);
      let requestBody: Record<string, unknown> | undefined;
      await models.models
        .streamSimple(
          models.models.getModel(provider.providerId, modelId)!,
          { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] },
          {
            reasoning: 'high',
            transport: 'sse',
            maxRetries: 0,
            fetch: async (url, init) => {
              const request = new Request(url, init);
              const bytes = Buffer.from(await request.arrayBuffer());
              requestBody = JSON.parse(
                (request.headers.get('content-encoding') === 'zstd'
                  ? zstdDecompressSync(bytes)
                  : bytes
                ).toString('utf8'),
              ) as Record<string, unknown>;
              return Response.json(
                { error: { message: 'Captured by test transport' } },
                { status: 400 },
              );
            },
          },
        )
        .result();
      expect(requestBody).toBeDefined();
      expectBody(requestBody!);
    },
  );

  it('merges catalog compat under the server-declared compat', () => {
    const models = createCoordinatorModels();
    models.useStepProvider({
      kind: 'http',
      providerId: 'z-ai',
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      api: 'openai-completions',
      compat: { supportsStore: true },
      models: [{ id: 'glm-5.3', name: 'GLM 5.3' }],
    });
    expect(models.models.getModel('z-ai', 'glm-5.3')?.compat).toMatchObject({
      thinkingFormat: 'zai',
      supportsReasoningEffort: true,
      supportsStore: true,
    });
  });

  it('asks Anthropic for one-hour cache writes on session requests, unless the operator opts out', async () => {
    const cacheControls: (string | null)[] = [];
    const sendTurn = async (sessionId: string | undefined) => {
      const models = createCoordinatorModels();
      models.useStepProvider(config);
      await models.setApiKey('anthropic-byok', 'sk-step');
      const model = models.models.getModel('anthropic-byok', 'claude-haiku-5-5');
      if (model === undefined) throw new Error('model missing');
      const abort = new AbortController();
      await models.models
        .streamSimple(
          model,
          { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
          {
            ...(sessionId !== undefined ? { sessionId } : {}),
            signal: abort.signal,
            onPayload: (payload) => {
              cacheControls.push(
                JSON.stringify(payload).match(/"cache_control":\{[^}]*\}/)?.[0] ?? null,
              );
              abort.abort();
              return payload;
            },
          },
        )
        .result();
    };
    await sendTurn('session-a');
    process.env.CAIRN_PI_CACHE_RETENTION = 'short';
    await sendTurn('session-a');
    delete process.env.CAIRN_PI_CACHE_RETENTION;
    await sendTurn(undefined);
    expect(cacheControls[0]).toContain('"ttl":"1h"');
    expect(cacheControls[1]).not.toContain('"ttl"');
    expect(cacheControls[2]).not.toContain('"ttl"');
  });
});

describe('thinking levels offered on Coordinator rows', () => {
  const anthropic = {
    providerId: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages' as const,
  };

  it.each([
    {
      modelId: 'claude-opus-5-5',
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: 'high',
    },
    {
      modelId: 'claude-haiku-4-5',
      levels: ['minimal', 'low', 'medium', 'high'],
      resolvesTo: 'off',
    },
    {
      modelId: 'claude-fable-5',
      levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: undefined,
    },
  ])(
    'anthropic $modelId offers $levels (default: $resolvesTo)',
    ({ modelId, levels, resolvesTo }) => {
      expect(inServerThinking(anthropic, modelId)).toEqual(
        resolvesTo === undefined ? { levels } : { levels, resolvesTo },
      );
    },
  );

  it.each([
    {
      label: 'a model the catalog marks non-reasoning',
      config: {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        api: 'openai-responses' as const,
      },
      modelId: 'gpt-4',
    },
    {
      label: 'a model the catalog does not know',
      config: anthropic,
      modelId: 'claude-sonnet-4-0',
    },
  ])('offers nothing for $label', ({ config, modelId }) => {
    expect(inServerThinking(config, modelId)).toEqual({ levels: [] });
  });

  it('offers nothing when the row speaks another api than the catalog entry', () => {
    expect(
      inServerThinking({ ...anthropic, api: 'openai-completions' as const }, 'claude-opus-5-5'),
    ).toEqual({ levels: [] });
  });

  it('reads the aliased zai catalog through the z-ai preset id', () => {
    expect(
      inServerThinking(
        {
          providerId: 'z-ai',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          api: 'openai-completions' as const,
        },
        'glm-5.3',
      ),
    ).toEqual({ levels: ['low', 'high', 'max'] });
  });

  it('keeps the Codex subscription behavior unchanged', () => {
    const codex = {
      providerId: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      api: 'openai-responses' as const,
    };
    expect(inServerThinking(codex, 'gpt-6-sol')).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: 'off',
    });
    expect(inServerThinking(codex, 'gpt-6.1-sol')).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('offers nothing for an unknown model on a custom endpoint', () => {
    expect(
      inServerThinking(
        {
          providerId: 'relay',
          baseUrl: 'https://relay.example.com/v1',
          api: 'openai-completions' as const,
        },
        'foo-custom-model',
      ),
    ).toEqual({ levels: [] });
  });

  it('borrows catalog thinking levels for known models on custom endpoints matching the api', () => {
    const anthropicUltra = {
      providerId: 'anthropic-ultra',
      baseUrl: 'https://ultra.example.com',
      api: 'anthropic-messages' as const,
    };
    expect(inServerThinking(anthropicUltra, 'claude-opus-5-5')).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: 'high',
    });
    expect(inServerThinking(anthropicUltra, 'anthropic/claude-sonnet-5-5')).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: 'high',
    });
    expect(inServerThinking(anthropicUltra, 'foo-custom-model')).toEqual({ levels: [] });
    expect(
      inServerThinking(
        {
          providerId: 'relay',
          baseUrl: 'https://relay.example.com/v1',
          api: 'openai-completions' as const,
        },
        'glm-5.3',
      ),
    ).toEqual({ levels: ['low', 'high', 'max'] });
  });

  it('registers catalog reasoning, compat, contextWindow and cost on a custom anthropic-messages endpoint and sends effort on the wire', async () => {
    const models = createCoordinatorModels();
    const anthropicUltra = {
      kind: 'http' as const,
      providerId: 'anthropic-ultra',
      baseUrl: 'https://ultra.example.com',
      api: 'anthropic-messages' as const,
      models: [
        { id: 'claude-opus-5-5', name: 'Opus 5.5' },
        { id: 'foo-custom-model', name: 'Custom' },
      ],
    };
    models.useStepProvider(anthropicUltra);
    const opus = models.models.getModel('anthropic-ultra', 'claude-opus-5-5');
    expect(opus).toMatchObject({
      reasoning: true,
      contextWindow: 1_000_000,
      thinkingLevelMap: expect.objectContaining({ off: null, xhigh: 'xhigh', max: 'max' }),
      compat: expect.objectContaining({
        forceAdaptiveThinking: true,
        supportsMidConvoEffort: true,
      }),
    });
    expect(opus?.cost.input).toBeGreaterThan(0);
    expect(models.models.getModel('anthropic-ultra', 'foo-custom-model')).toMatchObject({
      reasoning: false,
      thinkingLevelMap: undefined,
    });

    let requestBody: Record<string, unknown> | undefined;
    await models.models
      .streamSimple(
        opus!,
        { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] },
        {
          reasoning: 'xhigh',
          transport: 'sse',
          maxRetries: 0,
          fetch: async (url, init) => {
            const request = new Request(url, init);
            const bytes = Buffer.from(await request.arrayBuffer());
            requestBody = JSON.parse(
              (request.headers.get('content-encoding') === 'zstd'
                ? zstdDecompressSync(bytes)
                : bytes
              ).toString('utf8'),
            ) as Record<string, unknown>;
            return Response.json(
              { error: { message: 'Captured by test transport' } },
              { status: 400 },
            );
          },
        },
      )
      .result();
    expect(requestBody?.thinking).toMatchObject({ type: 'adaptive' });
    expect(requestBody?.messages).toContainEqual({
      role: 'system',
      content: [],
      output_config: { effort: 'xhigh' },
    });
  });
});

describe('thinking levels offered for Runner rows', () => {
  it('reads the aliased zai catalog through the z-ai preset id', () => {
    expect(
      piThinking(
        {
          providerId: 'z-ai',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
          api: 'openai-completions',
        },
        'glm-5.3',
      ),
    ).toEqual({ levels: ['low', 'high', 'max'], resolvesTo: 'high' });
  });

  it('resolves known models on custom endpoints like anthropic-ultra while leaving unknown models empty', () => {
    const anthropicUltra = {
      providerId: 'anthropic-ultra',
      baseUrl: 'https://ultra.example.com',
      api: 'anthropic-messages' as const,
    };
    expect(piThinking(anthropicUltra, 'claude-opus-5-5')).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: 'medium',
    });
    expect(piThinking(anthropicUltra, 'claude-haiku-5-5')).toEqual({
      levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
      resolvesTo: 'medium',
    });
    expect(piThinking(anthropicUltra, 'foo-custom-model')).toEqual({ levels: [] });
  });
});
