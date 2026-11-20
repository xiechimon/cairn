import { afterAll, expect, test } from 'vitest';
import { createProvider } from '../src/services/providers.js';
import {
  bootServer,
  insertDevinSubscription,
  insertMachine,
  req,
  type TestServer,
} from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

function world() {
  const s = bootServer();
  servers.push(s);
  const providerId = createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId: 'workbuddy',
        label: 'workbuddy',
        baseUrl: 'http://127.0.0.1:8798/v1',
        api: 'openai-completions',
        apiKey: 'workbuddy-key',
        models: [{ id: 'glm', name: 'glm' }],
      },
      createdBy: s.user.id,
    },
  ).id;
  const devinId = insertDevinSubscription(s);
  insertMachine(s, {
    name: 'devin-runner',
    capabilities: { mcpServers: [], skills: [], devin: { installed: true, version: '0.1.0' } },
  });
  return { s, providerKey: `provider:${providerId}`, devinKey: `subscription:${devinId}` };
}

const runtimes = async (s: TestServer) => {
  const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/model-sources`);
  const body = (await res.json()) as { sources: { runtime: string }[] };
  return body.sources.map((source) => source.runtime);
};

test('a saved provider order comes back with the providers and orders every model source', async () => {
  const { s, providerKey, devinKey } = world();
  expect(await runtimes(s)).toEqual(['pi', 'devin']);

  const put = await req(s.app, 'PUT', `/api/teams/${s.team.id}/provider-order`, {
    order: [devinKey, providerKey],
  });
  expect(put.status).toBe(200);

  const providers = await req(s.app, 'GET', `/api/teams/${s.team.id}/providers`);
  expect(((await providers.json()) as { order: string[] }).order).toEqual([devinKey, providerKey]);
  expect(await runtimes(s)).toEqual(['devin', 'pi']);
});

test('an order with an unknown key shape or a duplicate is refused', async () => {
  const { s, providerKey } = world();
  for (const order of [['machine:1'], [providerKey, providerKey]]) {
    const res = await req(s.app, 'PUT', `/api/teams/${s.team.id}/provider-order`, { order });
    expect(res.status).toBe(400);
  }
});
