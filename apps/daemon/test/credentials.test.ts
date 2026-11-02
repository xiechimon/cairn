import { describe, expect, test } from 'vitest';
import { clearCredentials, pushCredential } from '../src/credentials.js';

const TOKEN = {
  provider: null,
  secrets: {},
  git: { username: 'x-access-token', password: 'ghs_step' },
};

describe("pushCredential — git credential bound to the claim's cloneUrl (#1484)", () => {
  test('failure mode 1: binds cloneUrl', () => {
    expect(pushCredential(TOKEN, 'https://github.com/o/r.git').git).toEqual({
      username: 'x-access-token',
      password: 'ghs_step',
      url: 'https://github.com/o/r.git',
    });
  });

  test('failure mode 2: token response without git → null', () => {
    expect(pushCredential({ ...TOKEN, git: null }, 'https://github.com/o/r.git').git).toBeNull();
  });

  test('failure mode 3: step not bound to a repo → null', () => {
    expect(pushCredential(TOKEN, null).git).toBeNull();
  });
});

test('subscription credentials are cleared with the step lifetime', () => {
  const credentials = pushCredential(
    { ...TOKEN, claudeSubscriptionToken: 'private-lifetime-token' },
    null,
  );
  expect(credentials.claudeSubscriptionToken).toBe('private-lifetime-token');
  expect(credentials.secrets.names).toEqual([]);
  clearCredentials(credentials);
  expect(credentials.claudeSubscriptionToken).toBeUndefined();
});

describe('subscription token as the anthropic key for pi', () => {
  const subscription = 'private-anthropic-subscription-token';
  const anthropic = { kind: 'api_key' as const, providerId: 'anthropic' };

  test('a keyless anthropic provider takes the token and loses it on clear', () => {
    const credentials = pushCredential(
      { ...TOKEN, provider: anthropic, claudeSubscriptionToken: subscription },
      null,
    );
    expect(credentials.provider).toEqual({ ...anthropic, apiKey: subscription });
    clearCredentials(credentials);
    expect(credentials.provider).toBeNull();
    expect(JSON.stringify(credentials)).not.toContain(subscription);
  });

  test('a stored key, another provider or a missing token leave the provider unchanged', () => {
    const stored = { ...anthropic, kind: 'http' as const, apiKey: 'stored-key' };
    const keylessRow = { kind: 'http' as const, providerId: 'anthropic', baseUrl: 'https://relay' };
    const other = { kind: 'api_key' as const, providerId: 'openai' };
    for (const provider of [stored, keylessRow, { ...anthropic, apiKey: 'stored-key' }, other]) {
      expect(
        pushCredential({ ...TOKEN, provider, claudeSubscriptionToken: subscription }, null)
          .provider,
      ).toEqual(provider);
    }
    expect(pushCredential({ ...TOKEN, provider: anthropic }, null).provider).toEqual(anthropic);
    expect(
      pushCredential({ ...TOKEN, provider: null, claudeSubscriptionToken: subscription }, null)
        .provider,
    ).toBeNull();
  });
});
