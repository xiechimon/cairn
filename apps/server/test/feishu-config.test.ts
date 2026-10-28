import { afterEach, expect, test, vi } from 'vitest';
import { feishuBinding, team } from '../src/db/schema.js';
import { openSecretValues } from '../src/services/secrets.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
  vi.restoreAllMocks();
});

function setup() {
  const server = bootServer();
  servers.push(server);
  return { ...server, path: `/api/teams/${server.team.id}/feishu` };
}

const config = {
  appId: 'cli_example123',
  appSecret: 'test-feishu-secret-one',
  openId: 'ou_owner123',
  cairnOrigin: 'https://cairn.example.com',
};

const unconfigured = { configured: false, appId: null, openId: null, cairnOrigin: null };

test('configuration persists, replaces encrypted credentials, and completely unbinds without network calls', async () => {
  const s = setup();
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
  expect(await (await req(s.app, 'GET', s.path)).json()).toEqual(unconfigured);
  const saved = await req(s.app, 'PUT', s.path, config);
  expect(saved.status).toBe(200);
  const expected = {
    configured: true,
    appId: config.appId,
    openId: config.openId,
    cairnOrigin: config.cairnOrigin,
  };
  expect(await saved.json()).toEqual(expected);
  expect(await (await req(s.app, 'GET', s.path)).json()).toEqual(expected);
  const binding = s.db.select().from(feishuBinding).get();
  expect(binding).toBeDefined();
  expect(binding?.appIdCipher).toMatch(/^v1:/);
  expect(binding?.appSecretCipher).toMatch(/^v1:/);
  expect(binding?.appIdCipher).not.toContain(config.appId);
  expect(binding?.appSecretCipher).not.toContain(config.appSecret);
  expect(s.secretBox.open(binding?.appIdCipher ?? '')).toBe(config.appId);
  expect(s.secretBox.open(binding?.appSecretCipher ?? '')).toBe(config.appSecret);
  expect(binding?.createdAt).toBeGreaterThan(0);
  expect(binding?.updatedAt).toBeGreaterThan(0);
  const firstCreatedAt = binding?.createdAt ?? 0;
  expect((await req(s.app, 'PUT', s.path, { ...config, appSecret: '' })).status).toBe(200);
  expect(
    (await req(s.app, 'PUT', s.path, { ...config, appSecret: 'replacement-secret' })).status,
  ).toBe(200);
  const replacement = s.db.select().from(feishuBinding).get();
  expect(s.secretBox.open(replacement?.appIdCipher ?? '')).toBe(config.appId);
  expect(s.secretBox.open(replacement?.appSecretCipher ?? '')).toBe('replacement-secret');
  expect(replacement?.createdAt).toBe(firstCreatedAt);
  expect(replacement?.updatedAt).toBeGreaterThanOrEqual(firstCreatedAt);
  expect((await req(s.app, 'DELETE', s.path)).status).toBe(204);
  expect(s.db.select().from(feishuBinding).all()).toEqual([]);
  expect(await (await req(s.app, 'GET', s.path)).json()).toEqual(unconfigured);
  expect((await req(s.app, 'DELETE', s.path)).status).toBe(204);
  expect(network).not.toHaveBeenCalled();
});

test('invalid configuration never changes the binding or echoes credentials', async () => {
  const s = setup();
  for (const body of [
    null,
    {},
    { ...config, appId: 'not-an-app' },
    { ...config, openId: 'bad' },
    { ...config, appSecret: '' },
    { ...config, appSecret: '   ' },
    { ...config, cairnOrigin: 'javascript:alert(1)' },
    { ...config, cairnOrigin: 'https://user:password@example.com' },
    { ...config, cairnOrigin: 'https://example.com/path' },
  ]) {
    const response = await req(s.app, 'PUT', s.path, body);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(config.appSecret);
  }
  expect(s.db.select().from(feishuBinding).all()).toEqual([]);
  expect((await req(s.app, 'PUT', s.path, config)).status).toBe(200);
  const before = s.db.select().from(feishuBinding).get();
  expect(
    (await req(s.app, 'PUT', s.path, { ...config, appId: 'cli_other', appSecret: '' })).status,
  ).toBe(400);
  expect(s.db.select().from(feishuBinding).get()).toEqual(before);
});

test('other teams and unauthenticated callers cannot read or mutate configuration', async () => {
  const s = setup();
  s.db.insert(team).values({ id: 'other', name: 'Other', createdAt: 0 }).run();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    expect(
      (await req(s.app, method, '/api/teams/other/feishu', method === 'PUT' ? config : undefined))
        .status,
    ).toBe(404);
  }
  const locked = bootServer({ authToken: 'owner-token' });
  servers.push(locked);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    expect(
      (
        await req(
          locked.app,
          method,
          `/api/teams/${locked.team.id}/feishu`,
          method === 'PUT' ? config : undefined,
        )
      ).status,
    ).toBe(401);
  }
});

test('ordinary secret APIs keep feishu.bot names usable and never expose the binding ciphers', async () => {
  const s = setup();
  const secretsPath = `/api/teams/${s.team.id}/secrets`;
  expect((await req(s.app, 'PUT', s.path, config)).status).toBe(200);
  for (const name of ['feishu.bot.app-id', 'feishu.bot.app-secret', 'FEISHU.BOT.app-secret']) {
    const created = await req(s.app, 'POST', secretsPath, { name, value: 'user-owned-value' });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    expect(await (await req(s.app, 'GET', secretsPath)).json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, name })]),
    );
    expect(openSecretValues({ db: s.db, box: s.secretBox }, s.team.id, [id])).toEqual({
      [name]: 'user-owned-value',
    });
    await req(s.app, 'PATCH', `${secretsPath}/${id}`, { value: 'user-owned-updated' });
    expect(openSecretValues({ db: s.db, box: s.secretBox }, s.team.id, [id])).toEqual({
      [name]: 'user-owned-updated',
    });
    expect((await req(s.app, 'DELETE', `${secretsPath}/${id}`)).status).toBe(204);
  }
  expect(await (await req(s.app, 'GET', secretsPath)).json()).toEqual([]);
  expect(
    openSecretValues(
      { db: s.db, box: s.secretBox },
      s.team.id,
      s.db
        .select()
        .from(feishuBinding)
        .all()
        .map((row) => [row.appIdCipher, row.appSecretCipher])
        .flat(),
    ),
  ).toEqual({});
  expect(await (await req(s.app, 'GET', s.path)).json()).toEqual({
    configured: true,
    appId: config.appId,
    openId: config.openId,
    cairnOrigin: config.cairnOrigin,
  });
  await req(s.app, 'DELETE', s.path);
  expect(s.db.select().from(feishuBinding).all()).toEqual([]);
  expect(await (await req(s.app, 'GET', secretsPath)).json()).toEqual([]);
});

test('failed credential replacement rolls back the binding and its ciphers', async () => {
  const s = setup();
  expect((await req(s.app, 'PUT', s.path, config)).status).toBe(200);
  const before = s.db.select().from(feishuBinding).get();
  vi.spyOn(s.secretBox, 'seal')
    .mockImplementationOnce(() => 'unused-cipher')
    .mockImplementationOnce(() => {
      throw new Error('encryption failed');
    });
  const result = await req(s.app, 'PUT', s.path, {
    ...config,
    appId: 'cli_replacement',
    openId: 'ou_replacement',
  });
  expect(result.status).toBe(500);
  expect(s.db.select().from(feishuBinding).get()).toEqual(before);
  expect(await (await req(s.app, 'GET', s.path)).json()).toEqual({
    configured: true,
    appId: config.appId,
    openId: config.openId,
    cairnOrigin: config.cairnOrigin,
  });
});
