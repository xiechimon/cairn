import {
  API_KEY_PATTERN,
  maskApiKey,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  PROVIDER_XAI_PRESET,
  providerRecordSchema,
  secretRecordSchema,
  setSecretBodySchema,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  apiKey as apiKeyTable,
  provider as providerTable,
  secret as secretTable,
} from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { verifyApiKey } from '../src/services/api-keys.js';
import { bootServer, req, type TestServer } from './helpers.js';

const RELAY_KEY = 'sk-relay-super-secret-value';
const SECRET_VALUE = 'sk_live_stripe_value';

async function expectNoLeak(res: Response, ...plaintexts: string[]): Promise<unknown> {
  const text = await res.text();
  for (const plain of plaintexts) {
    expect(text, `leaked plaintext: ${plain}`).not.toContain(plain);
  }
  expect(text).not.toContain('"apiKey"');
  expect(text).not.toContain('keyHash');
  expect(text).not.toContain('Cipher');
  return JSON.parse(text) as unknown;
}

async function expectErrorShape(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
}

describe('provider surface (r3 section 2 + 02 section 8)', () => {
  function teamPath(s: TestServer, rest = ''): string {
    return `/api/teams/${s.team.id}/providers${rest}`;
  }

  test('GET envelope: presets[] 38 items verbatim + providers[] (envelope [inferred])', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', teamPath(s));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      presets: { id: string; auth: string; oauthLabel?: string }[];
      providers: unknown[];
    };
    expect(body.presets.map((p) => p.id)).toEqual([...PROVIDER_PRESET_IDS]);
    expect(body.presets).toHaveLength(38);
    const oauth = body.presets.filter((p) => p.auth === 'oauth').map((p) => p.id);
    expect(oauth).toEqual([...PROVIDER_OAUTH_PRESET_IDS]);
    const xai = body.presets.find((p) => p.id === PROVIDER_XAI_PRESET.id);
    expect(xai?.auth).toBe('api_key');
    expect(xai?.oauthLabel).toBe(PROVIDER_XAI_PRESET.oauthLabel);
    expect(body.providers).toEqual([]);
  });

  test('POST custom endpoint: 201 record with no apiKey field; v1 envelope ciphertext decrypts via SecretBox', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', teamPath(s), {
      providerId: 'my-relay',
      label: 'r3-gw',
      baseUrl: 'https://api.example.com/v1',
      api: 'anthropic-messages',
      apiKey: RELAY_KEY,
      models: [{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }],
    });
    expect(res.status).toBe(201);
    const record = providerRecordSchema.parse(await expectNoLeak(res, RELAY_KEY));
    expect(record).toMatchObject({
      kind: 'custom',
      providerId: 'my-relay',
      label: 'r3-gw',
      baseUrl: 'https://api.example.com/v1',
      api: 'anthropic-messages',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      createdBy: s.user.id,
    });
    expect(record.models).toEqual([{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }]);

    const row = s.db.select().from(providerTable).all()[0];
    expect(row?.apiKeyCipher?.startsWith('v1:')).toBe(true);
    expect(row?.apiKeyCipher).not.toContain(RELAY_KEY);
    expect(s.secretBox.open(row?.apiKeyCipher ?? '')).toBe(RELAY_KEY);

    const list = await req(s.app, 'GET', teamPath(s));
    const envelope = (await expectNoLeak(list, RELAY_KEY)) as { providers: unknown[] };
    expect(envelope.providers).toHaveLength(1);
    expect(providerRecordSchema.safeParse(envelope.providers[0]).success).toBe(true);
  });

  test('POST keyless gateway may leave it blank (r3 section 2 form note); duplicate providerId -> 409 [design]', async () => {
    const s = bootServer();
    const body = {
      providerId: 'gw',
      label: 'gw',
      baseUrl: 'http://127.0.0.1:4000/v1',
      api: 'openai-completions',
    };
    const first = await req(s.app, 'POST', teamPath(s), body);
    expect(first.status).toBe(201);
    const row = s.db.select().from(providerTable).all()[0];
    expect(row?.apiKeyCipher).toBeNull();
    await expectErrorShape(await req(s.app, 'POST', teamPath(s), body), 409);
    await expectErrorShape(
      await req(s.app, 'POST', teamPath(s), { ...body, providerId: 'x', api: 'nope' }),
      400,
    );
  });

  test('PATCH replacing the key -> re-encrypts; apiKey:null clears; response never echoes back', async () => {
    const s = bootServer();
    const created = providerRecordSchema.parse(
      await (
        await req(s.app, 'POST', teamPath(s), {
          providerId: 'my-relay',
          label: 'r3-gw',
          baseUrl: 'https://api.example.com/v1',
          api: 'anthropic-messages',
          apiKey: RELAY_KEY,
        })
      ).json(),
    );
    const patched = await req(s.app, 'PATCH', teamPath(s, `/${created.id}`), {
      label: 'r3-gw-2',
      apiKey: 'sk-rotated',
    });
    expect(patched.status).toBe(200);
    const record = providerRecordSchema.parse(await expectNoLeak(patched, RELAY_KEY, 'sk-rotated'));
    expect(record.label).toBe('r3-gw-2');
    const row = s.db.select().from(providerTable).all()[0];
    expect(s.secretBox.open(row?.apiKeyCipher ?? '')).toBe('sk-rotated');
    expect(row?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    const cleared = await req(s.app, 'PATCH', teamPath(s, `/${created.id}`), { apiKey: null });
    expect(cleared.status).toBe(200);
    expect(s.db.select().from(providerTable).all()[0]?.apiKeyCipher).toBeNull();

    await expectErrorShape(await req(s.app, 'PATCH', teamPath(s, '/nope'), { label: 'x' }), 404);
  });

  test('DELETE -> 204; deleting again 404; unknown team always 404', async () => {
    const s = bootServer();
    const created = providerRecordSchema.parse(
      await (
        await req(s.app, 'POST', teamPath(s), {
          providerId: 'p',
          label: 'p',
          baseUrl: 'https://x.example.com/v1',
          api: 'openai-responses',
        })
      ).json(),
    );
    expect((await req(s.app, 'DELETE', teamPath(s, `/${created.id}`))).status).toBe(204);
    await expectErrorShape(await req(s.app, 'DELETE', teamPath(s, `/${created.id}`)), 404);
    await expectErrorShape(await req(s.app, 'GET', '/api/teams/nope/providers'), 404);
  });
});

describe('secret surface (team secrets, r2 section 6.3 + 02 section 8 write-only)', () => {
  function teamPath(s: TestServer, rest = ''): string {
    return `/api/teams/${s.team.id}/secrets${rest}`;
  }
  const body = {
    name: 'STRIPE_API_KEY',
    description: '该密钥的用途',
    value: SECRET_VALUE,
  };

  test('POST: body = shared setSecretBodySchema; 201 record without the value field', async () => {
    const s = bootServer();
    expect(setSecretBodySchema.safeParse(body).success).toBe(true);
    const res = await req(s.app, 'POST', teamPath(s), body);
    expect(res.status).toBe(201);
    const record = secretRecordSchema.parse(await expectNoLeak(res, SECRET_VALUE));
    expect(record).toMatchObject({
      teamId: s.team.id,
      name: body.name,
      description: body.description,
    });

    const row = s.db.select().from(secretTable).all()[0];
    expect(row?.valueCipher?.startsWith('v1:')).toBe(true);
    expect(s.secretBox.open(row?.valueCipher ?? '')).toBe(SECRET_VALUE);
  });

  test('GET list = SecretRecord[] (value never appears); duplicate name -> 409 [design]', async () => {
    const s = bootServer();
    await req(s.app, 'POST', teamPath(s), body);
    const res = await req(s.app, 'GET', teamPath(s));
    const list = (await expectNoLeak(res, SECRET_VALUE)) as unknown[];
    expect(list).toHaveLength(1);
    expect(secretRecordSchema.safeParse(list[0]).success).toBe(true);
    expect(Object.keys(list[0] as object).sort()).toEqual(['description', 'id', 'name', 'teamId']);
    await expectErrorShape(await req(s.app, 'POST', teamPath(s), body), 409);
  });

  test('PATCH overwriting the value -> re-encrypts ("after save only overwrite or delete" r2 section 6.3); renaming into another row 409, into itself allowed', async () => {
    const s = bootServer();
    const created = secretRecordSchema.parse(
      await (await req(s.app, 'POST', teamPath(s), body)).json(),
    );
    const patched = await req(s.app, 'PATCH', teamPath(s, `/${created.id}`), {
      value: 'sk_live_rotated',
    });
    expect(patched.status).toBe(200);
    await expectNoLeak(patched, SECRET_VALUE, 'sk_live_rotated');
    const row = s.db.select().from(secretTable).all()[0];
    expect(s.secretBox.open(row?.valueCipher ?? '')).toBe('sk_live_rotated');

    const selfRename = await req(s.app, 'PATCH', teamPath(s, `/${created.id}`), {
      name: 'STRIPE_API_KEY',
    });
    expect(selfRename.status).toBe(200);
    const other = secretRecordSchema.parse(
      await (await req(s.app, 'POST', teamPath(s), { name: 'OTHER_KEY', value: 'v2' })).json(),
    );
    await expectErrorShape(
      await req(s.app, 'PATCH', teamPath(s, `/${other.id}`), { name: 'STRIPE_API_KEY' }),
      409,
    );
    await expectErrorShape(await req(s.app, 'PATCH', teamPath(s, '/nope'), { value: 'x' }), 404);
  });

  test('PATCH rename allowed into itself; DELETE -> 204; deleting again 404', async () => {
    const s = bootServer();
    const created = secretRecordSchema.parse(
      await (await req(s.app, 'POST', teamPath(s), body)).json(),
    );
    const renamed = await req(s.app, 'PATCH', teamPath(s, `/${created.id}`), {
      name: 'STRIPE_KEY_V2',
    });
    expect(renamed.status).toBe(200);
    expect((secretRecordSchema.parse(await renamed.json()) as { name: string }).name).toBe(
      'STRIPE_KEY_V2',
    );
    expect((await req(s.app, 'DELETE', teamPath(s, `/${created.id}`))).status).toBe(204);
    await expectErrorShape(await req(s.app, 'DELETE', teamPath(s, `/${created.id}`)), 404);
    await expectErrorShape(await req(s.app, 'GET', '/api/teams/nope/secrets'), 404);
  });
});

describe('apiKey surface (r3 section 6 observed display rules + 02 section 8 hash storage)', () => {
  function teamPath(s: TestServer): string {
    return `/api/teams/${s.team.id}/api-keys`;
  }
  const body = {
    name: '笔记本',
    gitAccess: true,
    mcpAccess: true,
    toolGrants: { read: ['Todos', 'Projects'], write: ['Create Todo'] },
  };

  test('POST create: plaintext once cairn_<48hex> + row masked cairn_afe07565...; stored hashed', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', teamPath(s), body);
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      name: string;
      gitAccess: boolean;
      mcpAccess: boolean;
      toolGrants: { read: string[]; write: string[] };
      masked: string;
      createdAt: number;
      plaintext: string;
    };
    expect(API_KEY_PATTERN.test(created.plaintext)).toBe(true);
    expect(created.masked).toBe(maskApiKey(created.plaintext));
    expect(created.masked).toMatch(/^cairn_[0-9a-f]{8}…$/);
    expect(created.name).toBe('笔记本');
    expect(created.gitAccess).toBe(true);
    expect(created.mcpAccess).toBe(true);
    expect(created.toolGrants).toEqual({ read: ['Todos', 'Projects'], write: ['Create Todo'] });
    expect(Number.isInteger(created.createdAt)).toBe(true);

    const row = s.db.select().from(apiKeyTable).all()[0];
    expect(row?.keyHash).toBe(hashCredential(created.plaintext));
    expect(row?.masked).toBe(created.masked);
    expect(JSON.stringify(row)).not.toContain(created.plaintext);

    expect(verifyApiKey({ db: s.db }, created.plaintext)?.id).toBe(created.id);
    expect(verifyApiKey({ db: s.db }, 'cairn_wrong')).toBeNull();
  });

  test('GET list: masked rows, no plaintext no hash (no later view shows plaintext again)', async () => {
    const s = bootServer();
    const created = (await (await req(s.app, 'POST', teamPath(s), body)).json()) as {
      plaintext: string;
      id: string;
    };
    const res = await req(s.app, 'GET', teamPath(s));
    expect(res.status).toBe(200);
    const list = (await expectNoLeak(res, created.plaintext)) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(created.id);
    expect(list[0]?.masked).toBe(maskApiKey(created.plaintext));
    expect('plaintext' in (list[0] as object)).toBe(false);
    await expectErrorShape(await req(s.app, 'GET', '/api/teams/nope/api-keys'), 404);
  });

  test('POST optional name defaults to null; bad body 400', async () => {
    const s = bootServer();
    const res = await req(s.app, 'POST', teamPath(s), {
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { name: string | null }).name).toBeNull();
    await expectErrorShape(
      await req(s.app, 'POST', teamPath(s), { gitAccess: 'yes', toolGrants: {} }),
      400,
    );
  });
});
