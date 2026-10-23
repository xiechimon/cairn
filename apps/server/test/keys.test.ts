// 密钥三面对拍（02 §8 三层边界之 API 面 + r3 §2/§6 实测行为）：
// - provider：apiKey 只写不读——GET/PATCH 响应永不返回；密文经 SecretBox
//   （v1 信封落 apiKeyCipher [内部] 列）；presets[] 38 项原样（r3 §2）
// - secret：值只写不读（保存后只能覆盖或删除，r2 §6.3）；密文经 SecretBox
// - apiKey：创建响应含明文一次 `cairn_<48hex>`（r3 §6 原形前缀 tds_ 随槽切换）；
//   列表行掩码 `cairn_afe07565…`；服务端存哈希不存可逆值（[设计] 02 §8）
// 泄漏扫描纪律：三面全部 GET/POST/PATCH 响应串扫明文子串，命中即红。

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
  expect(text).not.toContain('"apiKey"'); // key 类字段名本身也不出现（只写不读）
  expect(text).not.toContain('keyHash');
  expect(text).not.toContain('Cipher');
  return JSON.parse(text) as unknown;
}

async function expectErrorShape(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
}

describe('provider 面（r3 §2 + 02 §8）', () => {
  function teamPath(s: TestServer, rest = ''): string {
    return `/api/teams/${s.team.id}/providers${rest}`;
  }

  test('GET 封套：presets[] 38 项原样 + providers[]（封套 [推断]）', async () => {
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
    expect(oauth).toEqual([...PROVIDER_OAUTH_PRESET_IDS]); // 仅二项（r3 §2）
    const xai = body.presets.find((p) => p.id === PROVIDER_XAI_PRESET.id);
    expect(xai?.auth).toBe('api_key'); // xai 双通道
    expect(xai?.oauthLabel).toBe(PROVIDER_XAI_PRESET.oauthLabel);
    expect(body.providers).toEqual([]);
  });

  test('POST 自定义端点：201 record 无 apiKey 字段；密文 v1 信封经 SecretBox 可解', async () => {
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
      authHeader: true, // 「以 Authorization: Bearer 请求头发送」默认勾（r3 §2 样本）
      compat: { supportsDeveloperRole: false },
      createdBy: s.user.id,
    });
    expect(record.models).toEqual([{ id: 'claude-sonnet-5', name: 'claude-sonnet-5' }]);

    // at-rest：apiKeyCipher = v1 信封；经同一 SecretBox 可解回明文（01 §4.2）。
    const row = s.db.select().from(providerTable).all()[0];
    expect(row?.apiKeyCipher?.startsWith('v1:')).toBe(true);
    expect(row?.apiKeyCipher).not.toContain(RELAY_KEY);
    expect(s.secretBox.open(row?.apiKeyCipher ?? '')).toBe(RELAY_KEY);

    // GET 列表同样只读掩码面（写只读，02 §8 API 面纪律）。
    const list = await req(s.app, 'GET', teamPath(s));
    const envelope = (await expectNoLeak(list, RELAY_KEY)) as { providers: unknown[] };
    expect(envelope.providers).toHaveLength(1);
    expect(providerRecordSchema.safeParse(envelope.providers[0]).success).toBe(true);
  });

  test('POST 无密钥网关可留空（r3 §2 表单注）；重复 providerId → 409 [设计]', async () => {
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

  test('PATCH 替换密钥 → 重加密；apiKey:null 清除；响应永不回显', async () => {
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

    // 凭证「可以替换或删除」（r2 §6.5）：null = 清除密钥位。
    const cleared = await req(s.app, 'PATCH', teamPath(s, `/${created.id}`), { apiKey: null });
    expect(cleared.status).toBe(200);
    expect(s.db.select().from(providerTable).all()[0]?.apiKeyCipher).toBeNull();

    await expectErrorShape(await req(s.app, 'PATCH', teamPath(s, '/nope'), { label: 'x' }), 404);
  });

  test('DELETE → 204；再删 404；未知 team 一律 404', async () => {
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

describe('secret 面（团队密钥，r2 §6.3 + 02 §8 只写不读）', () => {
  function teamPath(s: TestServer, rest = ''): string {
    return `/api/teams/${s.team.id}/secrets${rest}`;
  }
  const body = {
    name: 'STRIPE_API_KEY',
    description: '该密钥的用途',
    value: SECRET_VALUE,
  };

  test('POST：body = shared setSecretBodySchema；201 record 无 value 字段', async () => {
    const s = bootServer();
    expect(setSecretBodySchema.safeParse(body).success).toBe(true); // body 即契约
    const res = await req(s.app, 'POST', teamPath(s), body);
    expect(res.status).toBe(201);
    const record = secretRecordSchema.parse(await expectNoLeak(res, SECRET_VALUE));
    expect(record).toMatchObject({
      teamId: s.team.id,
      name: body.name,
      description: body.description,
    });

    // at-rest：valueCipher = v1 信封，SecretBox 可解（per-step 下发读点）。
    const row = s.db.select().from(secretTable).all()[0];
    expect(row?.valueCipher?.startsWith('v1:')).toBe(true);
    expect(s.secretBox.open(row?.valueCipher ?? '')).toBe(SECRET_VALUE);
  });

  test('GET 列表 = SecretRecord[]（值永不出现）；重名 → 409 [设计]', async () => {
    const s = bootServer();
    await req(s.app, 'POST', teamPath(s), body);
    const res = await req(s.app, 'GET', teamPath(s));
    const list = (await expectNoLeak(res, SECRET_VALUE)) as unknown[];
    expect(list).toHaveLength(1);
    expect(secretRecordSchema.safeParse(list[0]).success).toBe(true);
    expect(Object.keys(list[0] as object).sort()).toEqual(['description', 'id', 'name', 'teamId']);
    await expectErrorShape(await req(s.app, 'POST', teamPath(s), body), 409);
  });

  test('PATCH 覆盖值 → 重加密（「保存后只能覆盖或删除」r2 §6.3）；改名撞他行 409、撞自身放行', async () => {
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

    // 改名撞自身名 = no-op 放行；撞他行 = 409（env 名唯一 [设计]）。
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

  test('PATCH 改名放行自身；DELETE → 204；再删 404', async () => {
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

describe('apiKey 面（r3 §6 实测展示规则 + 02 §8 存哈希）', () => {
  function teamPath(s: TestServer): string {
    return `/api/teams/${s.team.id}/api-keys`;
  }
  const body = {
    name: '笔记本',
    gitAccess: true,
    mcpAccess: true,
    toolGrants: { read: ['Todos', 'Projects'], write: ['Create Todo'] },
  };

  test('POST 创建：明文一次 cairn_<48hex> + 行掩码 cairn_afe07565…；库存哈希', async () => {
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
    // 明文一次（r3 §6：创建后一次性明文；文案 canon 由 web 面渲染 shared 常量）。
    expect(API_KEY_PATTERN.test(created.plaintext)).toBe(true);
    // 行掩码 = 品牌前缀 + 前 8 hex + 省略号（r3 §6 展示规则，shared 单源）。
    expect(created.masked).toBe(maskApiKey(created.plaintext));
    expect(created.masked).toMatch(/^cairn_[0-9a-f]{8}…$/);
    expect(created.name).toBe('笔记本');
    expect(created.gitAccess).toBe(true);
    expect(created.mcpAccess).toBe(true);
    expect(created.toolGrants).toEqual({ read: ['Todos', 'Projects'], write: ['Create Todo'] });
    expect(Number.isInteger(created.createdAt)).toBe(true);

    // 存哈希不存可逆值（[设计] 02 §8）：明文与哈希之外无第三形态。
    const row = s.db.select().from(apiKeyTable).all()[0];
    expect(row?.keyHash).toBe(hashCredential(created.plaintext));
    expect(row?.masked).toBe(created.masked);
    expect(JSON.stringify(row)).not.toContain(created.plaintext);

    // 校验只需匹配（verifyApiKey = 机器注册/MCP Bearer 挂接点，面归 M3）。
    expect(verifyApiKey({ db: s.db }, created.plaintext)?.id).toBe(created.id);
    expect(verifyApiKey({ db: s.db }, 'cairn_wrong')).toBeNull();
  });

  test('GET 列表：掩码行、无明文无哈希（此后任何视图不再出现明文）', async () => {
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

  test('POST 可选名称缺省 null；坏 body 400', async () => {
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
