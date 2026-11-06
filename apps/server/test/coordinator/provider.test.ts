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
});
