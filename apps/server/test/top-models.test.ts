import type { TopModel } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { openMemoryDb } from '../src/db/client.js';
import { team } from '../src/db/schema.js';
import { readTopModels, writeTopModels } from '../src/services/top-models.js';
import { bootServer, req } from './helpers.js';

const OPUS: TopModel = {
  provider: 'claude-code',
  modelId: 'claude-opus-5-5',
  thinkingLevel: 'high',
};
const SOL: TopModel = { provider: 'openai', modelId: 'gpt-6.1-sol', thinkingLevel: null };

function path(teamId: string) {
  return `/api/teams/${teamId}/top-models`;
}

async function read(s: ReturnType<typeof bootServer>) {
  const res = await req(s.app, 'GET', path(s.team.id));
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
    const first = await req(s.app, 'PUT', path(s.team.id), { models: [OPUS, SOL] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ models: [OPUS, SOL] });
    await req(s.app, 'PUT', path(s.team.id), { models: [SOL] });
    expect(await read(s)).toEqual({ models: [SOL] });
  });

  test('an empty list is stored and stays distinct from the reset state', async () => {
    const s = bootServer();
    await req(s.app, 'PUT', path(s.team.id), { models: [] });
    expect(await read(s)).toEqual({ models: [] });
    const reset = await req(s.app, 'DELETE', path(s.team.id));
    expect(await reset.json()).toEqual({ models: null });
    expect(await read(s)).toEqual({ models: null });
  });

  test.each([
    ['a duplicate provider and model', { models: [OPUS, { ...OPUS, thinkingLevel: 'low' }] }],
    [
      'more than eight entries',
      { models: Array.from({ length: 9 }, (_, i) => ({ ...SOL, modelId: `m${i}` })) },
    ],
    ['an unknown thinking level', { models: [{ ...OPUS, thinkingLevel: 'extreme' }] }],
    ['a missing thinking level', { models: [{ provider: 'openai', modelId: 'gpt-6.1-sol' }] }],
    ['an empty model id', { models: [{ ...SOL, modelId: '' }] }],
    ['no models key', {}],
  ])('PUT with %s is refused and leaves the stored list unchanged', async (_name, body) => {
    const s = bootServer();
    await req(s.app, 'PUT', path(s.team.id), { models: [OPUS] });
    const res = await req(s.app, 'PUT', path(s.team.id), body);
    expect(res.status).toBe(400);
    expect(await read(s)).toEqual({ models: [OPUS] });
  });

  test('the same model id under two providers is allowed', async () => {
    const s = bootServer();
    const res = await req(s.app, 'PUT', path(s.team.id), {
      models: [OPUS, { ...OPUS, provider: 'anthropic' }],
    });
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
    await req(s.app, 'PUT', path(s.team.id), { models: [SOL] });
    expect(await read(s)).toEqual({ models: [SOL] });
  });

  test('another team id is not found on every method', async () => {
    const s = bootServer();
    expect((await req(s.app, 'GET', path('nope'))).status).toBe(404);
    expect((await req(s.app, 'PUT', path('nope'), { models: [] })).status).toBe(404);
    expect((await req(s.app, 'DELETE', path('nope'))).status).toBe(404);
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
