import { afterEach, describe, expect, it } from 'vitest';
import { createCoordinatorModels } from '../../src/coordinator/runtime/models.js';

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
