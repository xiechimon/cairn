import { eq } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import { provider } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import {
  providerConfigurationInput,
  providerCredentialId,
} from '../src/services/provider-configuration.js';
import { testProviderConnection } from '../src/services/provider-test.js';
import {
  createProvider,
  listProviders,
  markProviderModelTextOnly,
  updateProvider,
} from '../src/services/providers.js';

const KEY = 'fixture-provider-key';
const NOW = 1_800_000_000_000;
const claims = Buffer.from(
  JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' } }),
).toString('base64url');

function fixture(providerId = 'engineering-relay', apiKey = KEY) {
  const { db, close } = openDbWithHandle(':memory:');
  const { team, user } = seed(db);
  const deps = { db, box: createEphemeralSecretBox() };
  const record = createProvider(deps, {
    teamId: team.id,
    createdBy: user.id,
    body: {
      providerId,
      label: 'Engineering relay',
      baseUrl: 'https://provider.example.test/v1',
      api: providerId === 'openai-codex' ? 'openai-responses' : 'openai-completions',
      authHeader: false,
      compat: { supportsStore: false, supportsDeveloperRole: true },
      models: [{ id: 'small-model', name: 'Small model' }],
      apiKey,
    },
  });
  return {
    deps,
    close,
    record,
    input: { teamId: team.id, id: record.id },
    read: () => listProviders(deps, team.id)[0]!,
    save: (patch: Parameters<typeof updateProvider>[3]) =>
      updateProvider(deps, team.id, record.id, patch),
  };
}

afterEach(() => vi.restoreAllMocks());

it('keeps the same fingerprint for equal probe configurations regardless of metadata or property order', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const f = fixture();
  try {
    expect(f.record.configurationFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(f.read().configurationFingerprint).toBe(f.record.configurationFingerprint);
    clock.mockReturnValue(NOW - 1);
    const saved = f.save({
      label: 'Renamed relay',
      compat: { supportsDeveloperRole: true, supportsStore: false },
      models: [{ name: 'Renamed small model', id: 'small-model' }],
    });
    expect(saved.updatedAt).toBe(f.record.updatedAt + 1);
    expect(saved.configurationFingerprint).toBe(f.record.configurationFingerprint);
  } finally {
    f.close();
  }
});

it('distinguishes endpoint, auth mode and credential changes saved in one millisecond', () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const f = fixture();
  try {
    const records = [
      f.record,
      f.save({ baseUrl: 'https://other.example.test/v1' }),
      f.save({ authHeader: true }),
      f.save({ api: 'anthropic-messages' }),
      f.save({ providerId: 'renamed-engineering-relay' }),
      f.save({ apiKey: 'fixture-replacement-key' }),
      f.save({ compat: { supportsStore: true, supportsDeveloperRole: true } }),
      f.save({ apiKey: null }),
    ];
    expect(records.map((record) => record.updatedAt)).toEqual(
      records.map((_, index) => NOW + index),
    );
    expect(new Set(records.map((record) => record.configurationFingerprint)).size).toBe(
      records.length,
    );
    expect(f.read()).toEqual(records.at(-1));
  } finally {
    f.close();
  }
});

it('keeps the connection fingerprint across model additions, removals, ordering and metadata edits', () => {
  const f = fixture();
  try {
    const changes = [
      [
        { id: 'small-model', name: 'Small model' },
        { id: 'large-model', name: 'Large model' },
      ],
      [
        { id: 'large-model', name: 'Large model' },
        { id: 'small-model', name: 'Small model' },
      ],
      [
        {
          id: 'small-model',
          name: 'Renamed model',
          contextWindow: 200_000,
          maxTokens: 8192,
          input: ['text' as const],
          cost: { input: 1, output: 2 },
        },
      ],
      [],
    ];
    for (const models of changes) {
      expect(f.save({ models }).configurationFingerprint).toBe(f.record.configurationFingerprint);
      expect(f.read().configurationFingerprint).toBe(f.record.configurationFingerprint);
    }
  } finally {
    f.close();
  }
});

it('advances the version for model input discovery even after the clock moves backwards', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const f = fixture();
  try {
    const saved = f.save({ label: 'New label' });
    clock.mockReturnValue(NOW - 100);
    markProviderModelTextOnly(f.deps, f.input.teamId, f.record.providerId, 'small-model');
    expect(f.read().updatedAt).toBe(saved.updatedAt + 1);
    expect(f.read().models[0]!.input).toEqual(['text']);
  } finally {
    f.close();
  }
});

it('includes only the non-secret credential ID in canonical probe input', () => {
  const f = fixture();
  try {
    const row = f.deps.db.select().from(provider).where(eq(provider.id, f.record.id)).get()!;
    const credentialId = providerCredentialId(row)!;
    const input = providerConfigurationInput(row, credentialId);
    expect(credentialId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(input)).toEqual({
      providerId: row.providerId,
      baseUrl: row.baseUrl,
      api: row.api,
      authHeader: row.authHeader,
      credentialId,
      compat: { supportsStore: false, supportsDeveloperRole: true },
    });
    expect(input).not.toContain(KEY);
    expect(input).not.toContain(row.apiKeyCipher!);
    expect(JSON.stringify(f.read())).not.toContain(credentialId);
  } finally {
    f.close();
  }
});

it.each([
  { providerId: 'xai', kind: 'xai-oauth', access: 'fixture-next-access', legacy: false },
  {
    providerId: 'openai-codex',
    kind: 'codex-oauth',
    access: `header.${claims}.next`,
    legacy: true,
  },
])(
  'assigns the loaded fingerprint after a $providerId token refresh',
  async ({ providerId, kind, access, legacy }) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const f = fixture(
      providerId,
      JSON.stringify({
        kind,
        refresh: 'fixture-previous-refresh',
        access: 'fixture-previous-access',
        expires: NOW - 1,
        accountId: 'fixture-account',
      }),
    );
    try {
      if (legacy) {
        f.deps.db
          .update(provider)
          .set({ compat: f.record.compat })
          .where(eq(provider.id, f.record.id))
          .run();
      }
      const original = f.read();
      expect(original.configurationFingerprint).toMatch(/^[a-f0-9]{32}$/);
      const tokenFetch = vi.fn(async () =>
        Response.json({
          access_token: access,
          refresh_token: 'fixture-next-refresh',
          expires_in: 3600,
        }),
      );
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        return Response.json({ error: { message: 'Fixture denial' } }, { status: 401 });
      });
      f.save({ label: 'Metadata changed before refresh' });
      clock.mockReturnValue(NOW - 1);
      const result = await testProviderConnection({ ...f.deps, fetch, tokenFetch }, f.input);
      expect(tokenFetch).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
        `Bearer ${access}`,
      );
      expect(result).toMatchObject({
        status: 'failed',
        failure: 'auth',
        configurationFingerprint: original.configurationFingerprint,
      });
      expect(f.read()).toMatchObject({
        updatedAt: NOW + 2,
        configurationFingerprint: original.configurationFingerprint,
      });
    } finally {
      f.close();
    }
  },
);

it('returns the loaded fingerprint when the endpoint changes during the upstream request', async () => {
  const f = fixture();
  try {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      f.save({ baseUrl: 'https://next.example.test/v1' });
      return Response.json({ error: { message: 'Fixture denial' } }, { status: 401 });
    });
    const result = await testProviderConnection({ ...f.deps, fetch }, f.input);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://provider.example.test/v1/chat/completions');
    expect(result.configurationFingerprint).toBe(f.record.configurationFingerprint);
    expect(f.read().configurationFingerprint).not.toBe(result.configurationFingerprint);
  } finally {
    f.close();
  }
});

it('does not probe with a different credential returned during token resolution', async () => {
  const f = fixture(
    'xai',
    JSON.stringify({
      kind: 'xai-oauth',
      refresh: 'fixture-previous-refresh',
      access: 'fixture-previous-access',
      expires: 0,
    }),
  );
  try {
    const tokenFetch = vi.fn(async () => {
      f.save({ apiKey: 'fixture-replacement-key' });
      return Response.json({
        access_token: 'fixture-next-access',
        refresh_token: 'fixture-next-refresh',
        expires_in: 3600,
      });
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await testProviderConnection({ ...f.deps, fetch, tokenFetch }, f.input);
    expect(tokenFetch).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'failed',
      configurationFingerprint: f.record.configurationFingerprint,
    });
    expect(result.configurationFingerprint).not.toBe(f.read().configurationFingerprint);
  } finally {
    f.close();
  }
});
