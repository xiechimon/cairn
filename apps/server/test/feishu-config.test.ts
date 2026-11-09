import { DB_TABLES, INTERNAL_ONLY_TABLES, WEB_REST_ENDPOINTS } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { openSecretValues } from '../src/services/secrets.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
});

test.each(['GET', 'PUT', 'DELETE'])('retired Feishu %s endpoint returns 404', async (method) => {
  const server = bootServer();
  servers.push(server);
  const response = await req(server.app, method, `/api/teams/${server.team.id}/feishu`);
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('appSecret');
});

test('paired devices also see the retired endpoint as absent', async () => {
  const server = bootServer({ authToken: 'test-owner' });
  servers.push(server);
  const codeResponse = await server.app.request('/api/remote/pairing', {
    method: 'POST',
    headers: { authorization: 'Bearer test-owner' },
  });
  const { code } = (await codeResponse.json()) as { code: string };
  const paired = await req(server.app, 'POST', '/api/remote/pair', { code, name: 'Test device' });
  const { token } = (await paired.json()) as { token: string };
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const response = await server.app.request(`/api/teams/${server.team.id}/feishu`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(404);
  }
});

test('active protocol registries no longer advertise Feishu', () => {
  expect(DB_TABLES).not.toContain('feishu_binding');
  expect(INTERNAL_ONLY_TABLES).not.toContain('feishu_binding');
  expect(WEB_REST_ENDPOINTS.some((endpoint) => endpoint.path.includes('/feishu'))).toBe(false);
});

test('user-owned secrets with former bot names remain ordinary usable secrets', async () => {
  const server = bootServer();
  servers.push(server);
  const path = `/api/teams/${server.team.id}/secrets`;
  for (const name of ['feishu.bot.app-id', 'feishu.bot.app-secret', 'FEISHU.BOT.app-secret']) {
    const created = await req(server.app, 'POST', path, { name, value: 'user-owned-value' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(
      openSecretValues({ db: server.db, box: server.secretBox }, server.team.id, [id], null),
    ).toEqual({
      [name]: 'user-owned-value',
    });
    expect((await req(server.app, 'DELETE', `${path}/${id}`)).status).toBe(204);
  }
});
