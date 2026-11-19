import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  getModelLiveness,
  markModelDead,
  refreshRelayCatalog,
} from '../src/services/model-liveness.js';
import { bootServer, req } from './helpers.js';

let server: Server;
let origin = '';
const paths: string[] = [];
const authorizations: string[] = [];
let providerCount = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    paths.push(request.url ?? '');
    authorizations.push(request.headers.authorization ?? '');
    if (request.url?.endsWith('/v1/models') || request.url?.endsWith('/v4/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'listed-model' }] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('refreshRelayCatalog probes the models list under the base URL', () => {
  test.each([
    ['/v1', '/v1/models'],
    ['/v1/', '/v1/models'],
    ['/api/coding/paas/v4', '/api/coding/paas/v4/models'],
    ['', '/v1/models'],
    ['/anthropic', '/anthropic/v1/models'],
  ])('base URL ending %j requests %s', async (suffix, expected) => {
    const s = bootServer();
    try {
      providerCount += 1;
      const providerId = `probe-${providerCount}`;
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
        providerId,
        label: 'Probe',
        baseUrl: `${origin}${suffix}`,
        api: 'openai-completions',
        apiKey: 'sk-probe',
        models: [{ id: 'listed-model', name: 'Listed' }],
      });
      expect(res.status).toBe(201);
      paths.length = 0;
      await refreshRelayCatalog({ db: s.db, box: s.secretBox }, s.team.id, providerId);
      expect(paths).toEqual([expected]);
      expect(getModelLiveness(s.team.id, providerId, 'listed-model')).toBe('alive');
    } finally {
      s.dispose();
    }
  });
});

test('a subscription provider is probed with its access token, never the stored OAuth secret', async () => {
  const s = bootServer();
  try {
    const providerId = 'probe-subscription';
    const secret = JSON.stringify({
      kind: 'xai-oauth',
      refresh: 'refresh-fixture',
      access: 'access-fixture',
      expires: Date.now() + 3_600_000,
    });
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
      providerId,
      label: 'Subscription',
      baseUrl: `${origin}/v1`,
      api: 'openai-completions',
      apiKey: secret,
      models: [{ id: 'listed-model', name: 'Listed' }],
    });
    expect(res.status).toBe(201);
    authorizations.length = 0;
    await refreshRelayCatalog({ db: s.db, box: s.secretBox }, s.team.id, providerId);
    expect(authorizations).toEqual(['Bearer access-fixture']);
  } finally {
    s.dispose();
  }
});

test("liveness state is scoped per team: one team cannot share another team's catalog or dead marks", async () => {
  const a = bootServer();
  const b = bootServer();
  try {
    expect(a.team.id).not.toBe(b.team.id);
    for (const s of [a, b]) {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
        providerId: 'shared-relay',
        label: 'Relay',
        baseUrl: `${origin}/v1`,
        api: 'openai-completions',
        apiKey: 'sk-probe',
        models: [{ id: 'listed-model', name: 'Listed' }],
      });
      expect(res.status).toBe(201);
    }
    await refreshRelayCatalog({ db: a.db, box: a.secretBox }, a.team.id, 'shared-relay');
    expect(getModelLiveness(a.team.id, 'shared-relay', 'listed-model')).toBe('alive');
    expect(getModelLiveness(b.team.id, 'shared-relay', 'listed-model')).toBe('unknown');
    markModelDead(a.team.id, 'shared-relay', 'listed-model');
    expect(getModelLiveness(b.team.id, 'shared-relay', 'listed-model')).not.toBe('dead');
    expect(getModelLiveness(a.team.id, 'shared-relay', 'listed-model')).toBe('dead');
  } finally {
    a.dispose();
    b.dispose();
  }
});
