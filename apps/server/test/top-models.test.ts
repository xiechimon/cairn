import type { PairResponse, TopModel } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { openMemoryDb } from '../src/db/client.js';
import { team } from '../src/db/schema.js';
import { readTopModels, writeTopModels } from '../src/services/top-models.js';
import { bootServer, req, type TestServer } from './helpers.js';

const OPUS: TopModel = {
  provider: 'claude-code',
  modelId: 'claude-opus-5-5',
  thinkingLevel: 'high',
};
const SOL: TopModel = { provider: 'openai', modelId: 'gpt-6.1-sol', thinkingLevel: null };

const OWNER_TOKEN = 'top-models-owner-token-0123456789abcdef';
const PAGE = { 'sec-fetch-site': 'same-origin' } as const;

function path(teamId: string) {
  return `/api/teams/${teamId}/top-models`;
}

function call(
  s: TestServer,
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<Response> {
  return Promise.resolve(
    s.app.request(url, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );
}

function write(s: TestServer, models: TopModel[], headers: Record<string, string> = {}) {
  return call(s, 'PUT', path(s.team.id), { headers: { ...PAGE, ...headers }, body: { models } });
}

async function read(s: TestServer, headers: Record<string, string> = {}) {
  const res = await call(s, 'GET', path(s.team.id), { headers });
  expect(res.status).toBe(200);
  return res.json();
}

describe('team top models API', () => {
  test('a team with no stored list reads null', async () => {
    const s = bootServer();
    expect(await read(s)).toEqual({ models: null });
  });

  test('PUT replaces the whole list in order and GET reads it back', async () => {
    const s = bootServer();
    const first = await write(s, [OPUS, SOL]);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ models: [OPUS, SOL] });
    await write(s, [SOL]);
    expect(await read(s)).toEqual({ models: [SOL] });
  });

  test('an empty list is stored and stays distinct from never having set one', async () => {
    const s = bootServer();
    expect(await read(s)).toEqual({ models: null });
    await write(s, []);
    expect(await read(s)).toEqual({ models: [] });
  });

  test('any number of models is accepted', async () => {
    const s = bootServer();
    const models = Array.from({ length: 12 }, (_, i) => ({ ...SOL, modelId: `m${i}` }));
    expect((await write(s, models)).status).toBe(200);
    expect(await read(s)).toEqual({ models });
  });

  test.each([
    ['a duplicate provider and model', { models: [OPUS, { ...OPUS, thinkingLevel: 'low' }] }],
    ['an unknown thinking level', { models: [{ ...OPUS, thinkingLevel: 'extreme' }] }],
    ['a missing thinking level', { models: [{ provider: 'openai', modelId: 'gpt-6.1-sol' }] }],
    ['an empty model id', { models: [{ ...SOL, modelId: '' }] }],
    ['no models key', {}],
  ])('PUT with %s is refused and leaves the stored list unchanged', async (_name, body) => {
    const s = bootServer();
    await write(s, [OPUS]);
    const res = await call(s, 'PUT', path(s.team.id), { headers: PAGE, body });
    expect(res.status).toBe(400);
    expect(await read(s)).toEqual({ models: [OPUS] });
  });

  test('the same model id under two providers is allowed', async () => {
    const s = bootServer();
    const res = await write(s, [OPUS, { ...OPUS, provider: 'anthropic' }]);
    expect(res.status).toBe(200);
  });

  test.each([
    ['unparseable JSON', '{bad'],
    ['JSON of the wrong shape', '{"provider":"openai"}'],
    ['a list that breaks the uniqueness rule', JSON.stringify([OPUS, OPUS])],
  ])('a stored row holding %s reads null without breaking team reads', async (_name, raw) => {
    const s = bootServer();
    s.db.run(
      sql`INSERT INTO team_top_models (teamId, models, updatedAt) VALUES (${s.team.id}, ${raw}, 1)`,
    );
    expect(await read(s)).toEqual({ models: null });
    expect((await req(s.app, 'GET', '/api/teams')).status).toBe(200);
    await write(s, [SOL]);
    expect(await read(s)).toEqual({ models: [SOL] });
  });

  test('another team id is not found on every method', async () => {
    const s = bootServer();
    expect((await req(s.app, 'GET', path('nope'))).status).toBe(404);
    expect(
      (await call(s, 'PUT', path('nope'), { headers: PAGE, body: { models: [] } })).status,
    ).toBe(404);
  });

  test('deleting a team removes only its own stored list', () => {
    const db = openMemoryDb();
    db.insert(team)
      .values([
        { id: 'a', name: 'A', createdAt: 0 },
        { id: 'b', name: 'B', createdAt: 0 },
      ])
      .run();
    writeTopModels(db, 'a', [OPUS]);
    writeTopModels(db, 'b', [SOL]);
    db.run(sql`DELETE FROM team WHERE id = 'a'`);
    expect(readTopModels(db, 'a')).toEqual({ models: null });
    expect(readTopModels(db, 'b')).toEqual({ models: [SOL] });
  });
});

describe('only the owner page changes the list', () => {
  test('a write with no page proof is refused with the ask-the-owner message and changes nothing', async () => {
    const s = bootServer();
    await write(s, [OPUS]);
    const res = await call(s, 'PUT', path(s.team.id), { body: { models: [SOL] } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('owner');
    expect(body.error).toContain('Settings');
    expect(await read(s)).toEqual({ models: [OPUS] });
  });

  test.each(['cross-site', 'same-site'])(
    'a write whose fetch metadata is %s is refused',
    async (site) => {
      const s = bootServer();
      const res = await call(s, 'PUT', path(s.team.id), {
        headers: { 'sec-fetch-site': site },
        body: { models: [SOL] },
      });
      expect(res.status).toBe(403);
      expect(await read(s)).toEqual({ models: null });
    },
  );

  test('a write with a different Origin is refused', async () => {
    const s = bootServer();
    const res = await call(s, 'PUT', path(s.team.id), {
      headers: { origin: 'http://other-host.example' },
      body: { models: [SOL] },
    });
    expect(res.status).toBe(403);
    expect(await read(s)).toEqual({ models: null });
  });

  test('a write with the matching Origin passes for a browser without fetch metadata', async () => {
    const s = bootServer();
    const res = await call(s, 'PUT', path(s.team.id), {
      headers: { origin: 'http://localhost' },
      body: { models: [SOL] },
    });
    expect(res.status).toBe(200);
  });

  test('a write whose fetch metadata is none (a directly opened page) passes', async () => {
    const s = bootServer();
    const res = await call(s, 'PUT', path(s.team.id), {
      headers: { 'sec-fetch-site': 'none' },
      body: { models: [SOL] },
    });
    expect(res.status).toBe(200);
  });

  test('duplicated fetch-metadata headers fail closed', async () => {
    const s = bootServer();
    const res = await s.app.request(path(s.team.id), {
      method: 'PUT',
      headers: [
        ['content-type', 'application/json'],
        ['sec-fetch-site', 'same-origin'],
        ['sec-fetch-site', 'same-origin'],
      ],
      body: JSON.stringify({ models: [SOL] }),
    });
    expect(res.status).toBe(403);
    expect(await read(s)).toEqual({ models: null });
  });

  test('GET stays open without the page proof', async () => {
    const s = bootServer();
    await write(s, [OPUS]);
    const res = await req(s.app, 'GET', path(s.team.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [OPUS] });
  });

  test('under token auth the owner token alone does not write, only the owner page does', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const bearer = { authorization: `Bearer ${OWNER_TOKEN}` };
    const refused = await call(s, 'PUT', path(s.team.id), {
      headers: bearer,
      body: { models: [SOL] },
    });
    expect(refused.status).toBe(403);
    const written = await call(s, 'PUT', path(s.team.id), {
      headers: { ...bearer, ...PAGE },
      body: { models: [SOL] },
    });
    expect(written.status).toBe(200);
    expect(await read(s, bearer)).toEqual({ models: [SOL] });
  });

  test('a paired device cannot write even with the page header', async () => {
    const s = bootServer({ authToken: OWNER_TOKEN });
    const ownerHeaders = { authorization: `Bearer ${OWNER_TOKEN}` };
    const pairing = await call(s, 'POST', '/api/remote/pairing', { headers: ownerHeaders });
    expect(pairing.status).toBe(201);
    const { code } = (await pairing.json()) as { code: string };
    const paired = await call(s, 'POST', '/api/remote/pair', { body: { code, name: 'phone' } });
    expect(paired.status).toBe(201);
    const { token } = (await paired.json()) as PairResponse;
    const res = await call(s, 'PUT', path(s.team.id), {
      headers: { authorization: `Bearer ${token}`, ...PAGE },
      body: { models: [SOL] },
    });
    expect(res.status).toBe(403);
    expect(await read(s, ownerHeaders)).toEqual({ models: null });
  });
});
