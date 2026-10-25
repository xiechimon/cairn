import { hostname } from 'node:os';
import { modelSourcesEnvelopeSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { getModelSources } from '../src/services/providers.js';
import { bootServer, issueApiKey, req, type TestServer } from './helpers.js';

function modelSourcesPath(s: TestServer): string {
  return `/api/teams/${s.team.id}/model-sources`;
}

async function postProvider(s: TestServer): Promise<void> {
  const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
    providerId: 'gw-test',
    label: '测试网关',
    baseUrl: 'https://gw.example.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'model-a', name: '模型甲' },
      { id: 'model-b', name: '模型乙' },
    ],
  });
  expect(res.status).toBe(201);
}

async function enroll(s: TestServer, name: string, claudeCode?: unknown): Promise<string> {
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: s.team.id,
      name,
      cliVersion: '0.1.0',
      ...(claudeCode !== undefined ? { claudeCode } : {}),
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function presence(token: string, s: TestServer, claudeCode: unknown): Promise<void> {
  const res = await s.app.request('/api/machine/presence', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ cliVersion: '0.1.0', claudeCode }),
  });
  expect(res.status).toBe(200);
}

function report(host: string, models: { id: string; name: string; slot?: string }[]) {
  return { installed: models.length > 0, hostname: host, models };
}

describe('getModelSources (service layer, aggregated per machine)', () => {
  test('fresh db: only the pi segment (no claude-code segment without a reporting machine), envelope passes the shared schema', () => {
    const s = bootServer();
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(env.sources.map((src) => src.runtime)).toEqual(['pi']);
    expect(env.sources[0]?.installed).toBe(true);
    expect(env.sources[0]?.hostname).toBe(hostname());
    expect(env.sources[0]?.models).toEqual([]);
    s.dispose();
  });

  test('pi segment = custom providers models[] projection (id/name verbatim, flattened across providers)', async () => {
    const s = bootServer();
    await postProvider(s);
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    const pi = env.sources.find((src) => src.runtime === 'pi');
    expect(pi?.models).toEqual([
      { id: 'model-a', name: '模型甲', liveness: 'unknown' },
      { id: 'model-b', name: '模型乙', liveness: 'unknown' },
    ]);
    s.dispose();
  });

  test('F1: execution machine reported values enter the segment -- server local files not read, segment hostname/models = reported values', async () => {
    const s = bootServer();
    const token = await enroll(s, 'exec-1');
    await presence(token, s, report('exec-host-1', [{ id: 'exec-model', name: 'exec-model' }]));
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(env.sources.map((src) => src.runtime)).toEqual(['pi', 'claude-code']);
    const cc = env.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.hostname).toBe('exec-host-1');
    expect(cc?.installed).toBe(true);
    expect(cc?.models).toEqual([{ id: 'exec-model', name: 'exec-model' }]);
    s.dispose();
  });

  test('F2: two machines one segment each + hostname faithful (sorted by machine name)', async () => {
    const s = bootServer();
    const tokenB = await enroll(s, 'exec-b');
    const tokenA = await enroll(s, 'exec-a');
    await presence(tokenB, s, report('host-b', [{ id: 'model-b', name: 'model-b' }]));
    await presence(tokenA, s, report('host-a', [{ id: 'model-a', name: 'model-a' }]));
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    const segments = env.sources.filter((src) => src.runtime === 'claude-code');
    expect(segments).toHaveLength(2);
    expect(segments.map((seg) => seg.hostname)).toEqual(['host-a', 'host-b']);
    expect(segments.map((seg) => seg.models[0]?.id)).toEqual(['model-a', 'model-b']);
    s.dispose();
  });

  test('F3: a machine without claude-code reports installed:false (segment present, models empty)', async () => {
    const s = bootServer();
    const token = await enroll(s, 'exec-plain');
    await presence(token, s, { installed: false, hostname: 'plain-host', models: [] });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    const cc = env.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.installed).toBe(false);
    expect(cc?.hostname).toBe('plain-host');
    expect(cc?.models).toEqual([]);
    s.dispose();
  });

  test('F6: a never-reported machine (legacy daemon) absent -- enroll without claudeCode means no segment', async () => {
    const s = bootServer();
    await enroll(s, 'legacy-1');
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(env.sources.map((src) => src.runtime)).toEqual(['pi']);
    s.dispose();
  });

  test('F7 (#1050): bin/auth passed through verbatim -- server does not synthesize or guess', async () => {
    const s = bootServer();
    const token = await enroll(s, 'exec-bin');
    await presence(token, s, {
      installed: true,
      hostname: 'bin-host',
      models: [{ id: 'm1', name: 'm1', slot: 'default' }],
      bin: { path: '/home/u/.local/bin/claude', version: '2.1.289' },
      auth: { state: 'not-logged-in', provider: 'firstParty' },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    const cc = env.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.bin).toEqual({ path: '/home/u/.local/bin/claude', version: '2.1.289' });
    expect(cc?.auth).toEqual({ state: 'not-logged-in', provider: 'firstParty' });
    s.dispose();
  });

  test('F8 (#1050): legacy shape (no bin/auth) -> two keys absent, no "unknown" written', async () => {
    const s = bootServer();
    const token = await enroll(s, 'exec-old');
    await presence(token, s, report('old-host', [{ id: 'm1', name: 'm1' }]));
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    const cc = env.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.bin).toBeUndefined();
    expect(cc?.auth).toBeUndefined();
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    s.dispose();
  });

  test('presence update reflects immediately: content changes right after the report changes (30s beat real-time semantics)', async () => {
    const s = bootServer();
    const token = await enroll(s, 'exec-1');
    await presence(token, s, report('exec-host-1', [{ id: 'model-old', name: 'model-old' }]));
    const deps = { db: s.db, box: s.secretBox };
    const before = getModelSources(deps, s.team.id).sources.find(
      (src) => src.runtime === 'claude-code',
    );
    await presence(token, s, report('exec-host-1', [{ id: 'model-new', name: 'model-new' }]));
    const after = getModelSources(deps, s.team.id).sources.find(
      (src) => src.runtime === 'claude-code',
    );
    expect(before?.models[0]?.id).toBe('model-old');
    expect(after?.models[0]?.id).toBe('model-new');
    s.dispose();
  });

  test('enroll already carries the report: the segment exists before the first presence', async () => {
    const s = bootServer();
    await enroll(s, 'exec-1', report('exec-host-1', [{ id: 'm-early', name: 'm-early' }]));
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    const cc = env.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.models).toEqual([{ id: 'm-early', name: 'm-early' }]);
    s.dispose();
  });
});

describe('GET /api/teams/:id/model-sources (route surface)', () => {
  test('unknown team -> 404 error shape', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/teams/nope/model-sources');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['error']);
    s.dispose();
  });

  test('200: pi first segment + reporting-machine segment + element shape', async () => {
    const s = bootServer();
    await postProvider(s);
    const token = await enroll(s, 'exec-1');
    await presence(token, s, report('exec-host-1', [{ id: 'exec-model', name: 'exec-model' }]));
    const res = await req(s.app, 'GET', modelSourcesPath(s));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sources: { runtime: string; installed: boolean; hostname: string; models: unknown[] }[];
    };
    expect(modelSourcesEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.sources.map((src) => src.runtime)).toEqual(['pi', 'claude-code']);
    const pi = body.sources.find((src) => src.runtime === 'pi');
    expect(pi?.models).toHaveLength(2);
    const cc = body.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.installed).toBe(true);
    expect(cc?.hostname).toBe('exec-host-1');
    s.dispose();
  });
});
