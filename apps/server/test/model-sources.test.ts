import { hostname } from 'node:os';
import { modelSourcesEnvelopeSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { builtinModelIds } from '../src/coordinator/runtime/provider.js';
import { createProvider, getModelSources, type ProviderBody } from '../src/services/providers.js';
import {
  bootServer,
  insertAntigravitySubscription,
  insertDevinSubscription,
  insertMachine,
  issueApiKey,
  req,
  type TestServer,
} from './helpers.js';

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

  test('one pi segment per provider, carrying its id and label, so a picked model names its provider', async () => {
    const s = bootServer();
    await postProvider(s);
    const second = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
      providerId: 'gw-two',
      label: 'Second',
      baseUrl: 'https://gw2.example.com/v1',
      api: 'openai-completions',
      models: [{ id: 'model-a', name: 'A again' }],
    });
    expect(second.status).toBe(201);
    const deepseek = await req(s.app, 'POST', `/api/teams/${s.team.id}/providers`, {
      providerId: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      api: 'openai-completions',
      apiKey: 'ds-key',
      models: [],
    });
    expect(deepseek.status).toBe(201);
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    const pi = env.sources.filter((src) => src.runtime === 'pi');
    expect(pi.map((src) => [src.provider, src.providerLabel])).toEqual([
      ['gw-test', '测试网关'],
      ['gw-two', 'Second'],
      ['deepseek', 'DeepSeek'],
    ]);
    expect(pi[0]?.models).toEqual([
      {
        id: 'model-a',
        name: '模型甲',
        liveness: 'unknown',
        thinkingLevels: [],
        inServerThinkingLevels: [],
      },
      {
        id: 'model-b',
        name: '模型乙',
        liveness: 'unknown',
        thinkingLevels: [],
        inServerThinkingLevels: [],
      },
    ]);
    expect(pi[1]?.models.map((m) => m.id)).toEqual(['model-a']);
    expect(pi[2]?.models.map((m) => m.id)).toEqual([...builtinModelIds('deepseek')]);
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
    expect(cc?.models).toEqual([{ id: 'exec-model', name: 'exec-model', thinkingLevels: [] }]);
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

  test('F7 (#1050): bin passes through verbatim and the Runner login stays out of the sources', async () => {
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
    expect(cc?.auth).toBeUndefined();
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
    expect(cc?.models).toEqual([{ id: 'm-early', name: 'm-early', thinkingLevels: [] }]);
    s.dispose();
  });
});

describe('managed-runtime sources follow the subscription, not a transient install flag', () => {
  test('devin: a machine that reports installed:false under an active subscription still lists swe-2-high', () => {
    const s = bootServer();
    insertDevinSubscription(s);
    insertMachine(s, {
      name: 'exec-devin',
      capabilities: {
        mcpServers: [],
        skills: [],
        devin: { installed: false },
      },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    const devin = env.sources.find((src) => src.runtime === 'devin');
    expect(devin).toBeDefined();
    expect(devin?.installed).toBe(false);
    expect(devin?.hostname).toBe('exec-devin');
    const swe2 = devin?.models.find((m) => m.id === 'swe-2-high');
    expect(swe2).toMatchObject({
      id: 'swe-2-high',
      name: 'SWE-2',
      thinkingLevels: ['medium', 'high', 'max'],
      thinkingDefault: 'high',
    });
    s.dispose();
  });

  test('devin: installed:false without a subscription keeps the source hidden', () => {
    const s = bootServer();
    insertMachine(s, {
      name: 'exec-devin',
      capabilities: {
        mcpServers: [],
        skills: [],
        devin: { installed: false },
      },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(env.sources.some((src) => src.runtime === 'devin')).toBe(false);
    s.dispose();
  });

  test('devin: a machine whose daemon predates managed devin (no devin block) stays hidden under a subscription', () => {
    const s = bootServer();
    insertDevinSubscription(s);
    insertMachine(s, {
      name: 'exec-legacy',
      capabilities: { mcpServers: [], skills: [] },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(env.sources.some((src) => src.runtime === 'devin')).toBe(false);
    s.dispose();
  });

  test('antigravity: a provisionable Runner lists API key models before installation', () => {
    const s = bootServer();
    insertAntigravitySubscription(s, { token: `AIzaSyA${'t'.repeat(28)}` });
    insertMachine(s, {
      name: 'exec-ag',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: false },
      },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    const ag = env.sources.find((src) => src.runtime === 'antigravity');
    expect(ag).toBeDefined();
    expect(ag?.installed).toBe(false);
    expect(ag?.hostname).toBe('exec-ag');
    expect(ag?.models.length).toBeGreaterThan(0);
    s.dispose();
  });

  test('antigravity: an uninstalled bound Runner cannot borrow a signed-in Runner catalog', async () => {
    const s = bootServer();
    try {
      const runnerId = insertMachine(s, {
        name: 'exec-ag',
        capabilities: { mcpServers: [], skills: [], antigravity: { installed: false } },
      });
      insertMachine(s, {
        name: 'other-ag',
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravity: {
            installed: true,
            authenticated: true,
            models: [{ id: 'other-model', name: 'Other Model' }],
          },
        },
      });
      const created = await req(
        s.app,
        'POST',
        `/api/teams/${s.team.id}/antigravity-subscriptions`,
        {
          label: 'Host',
          runnerId,
        },
      );
      expect(created.status).toBe(201);
      const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
      expect(env.sources.some((src) => src.runtime === 'antigravity')).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('antigravity: installed:false without a subscription keeps the source hidden', () => {
    const s = bootServer();
    insertMachine(s, {
      name: 'exec-ag',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: false },
      },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(env.sources.some((src) => src.runtime === 'antigravity')).toBe(false);
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

describe('thinking levels per model', () => {
  const levelsOf = (
    env: ReturnType<typeof getModelSources>,
    runtime: string,
    provider?: string,
  ): Record<
    string,
    { task?: string[]; taskDefault?: string; inServer?: string[]; inServerDefault?: string }
  > =>
    Object.fromEntries(
      env.sources
        .filter(
          (src) => src.runtime === runtime && (provider === undefined || src.provider === provider),
        )
        .flatMap((src) => src.models)
        .map((m) => [
          m.id,
          Object.fromEntries(
            Object.entries({
              task: m.thinkingLevels,
              taskDefault: m.thinkingDefault,
              inServer: m.inServerThinkingLevels,
              inServerDefault: m.inServerThinkingDefault,
            }).filter(([, v]) => v !== undefined),
          ),
        ]),
    );

  test('each model lists only the levels its backend tells apart, and Devin models keep the levels a Runner learned', () => {
    const s = bootServer();
    const bodies: ProviderBody[] = [
      {
        providerId: 'anthropic',
        label: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        api: 'anthropic-messages',
        models: [{ id: 'claude-opus-5-5', name: 'Opus' }],
      },
      {
        providerId: 'deepseek',
        label: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        api: 'openai-completions',
        models: [{ id: 'deepseek-v4-pro', name: 'V4 Pro' }],
      },
      {
        providerId: 'openai-codex',
        label: 'Codex',
        baseUrl: 'https://chatgpt.com/backend-api',
        api: 'openai-responses',
        models: [{ id: 'gpt-6-sol', name: 'Sol' }],
      },
      {
        providerId: 'z-ai',
        label: 'Z.AI',
        baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        api: 'openai-completions',
        models: [{ id: 'glm-5.3', name: 'GLM' }],
      },
      {
        providerId: 'relay',
        label: 'Relay',
        baseUrl: 'https://relay.example.com/v1',
        api: 'openai-completions',
        models: [{ id: 'glm-5.3', name: 'GLM' }],
      },
    ];
    for (const body of bodies) {
      createProvider({ db: s.db, box: s.secretBox }, { teamId: s.team.id, createdBy: 'u', body });
    }
    insertMachine(s, {
      name: 'mac',
      claudeCodeReport: {
        installed: true,
        hostname: 'mac',
        models: [
          { id: 'claude-opus-5-5', name: 'claude-opus-5-5' },
          { id: 'claude-opus-4-7', name: 'claude-opus-4-7' },
          { id: 'claude-opus-4-6', name: 'claude-opus-4-6' },
          { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
          { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
        ],
      },
      capabilities: {
        mcpServers: [],
        skills: [],
        devin: {
          installed: true,
          models: [
            { id: 'swe-2-high', name: 'SWE-2' },
            {
              id: 'claude-opus-5-5-medium',
              name: 'Opus via Devin',
              thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
            },
            { id: 'gpt-6-sol-medium', name: 'GPT via Devin' },
            { id: 'custom-unrun-model', name: 'Custom Unrun' },
          ],
        },
      },
    });
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    const claude = ['low', 'medium', 'high', 'xhigh', 'max'];
    expect(levelsOf(env, 'claude-code')).toEqual({
      'claude-opus-5-5': { task: claude, taskDefault: 'medium' },
      'claude-opus-4-7': { task: claude, taskDefault: 'xhigh' },
      'claude-opus-4-6': { task: ['low', 'medium', 'high', 'max'], taskDefault: 'high' },
      'claude-haiku-4-5': { task: [] },
      'deepseek-v4-pro': { task: [] },
    });
    expect(levelsOf(env, 'pi', 'anthropic')).toEqual({
      'claude-opus-5-5': {
        task: claude,
        taskDefault: 'medium',
        inServer: claude,
        inServerDefault: 'high',
      },
    });
    expect(levelsOf(env, 'pi', 'deepseek')).toEqual({
      'deepseek-v4-pro': {
        task: ['off', 'high', 'max'],
        taskDefault: 'high',
        inServer: ['high', 'max'],
        inServerDefault: 'off',
      },
    });
    expect(levelsOf(env, 'pi', 'z-ai')).toEqual({
      'glm-5.3': {
        task: ['low', 'high', 'max'],
        taskDefault: 'high',
        inServer: ['low', 'high', 'max'],
      },
    });
    expect(levelsOf(env, 'pi', 'openai-codex')).toEqual({
      'gpt-6-sol': {
        task: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
        taskDefault: 'medium',
        inServer: ['low', 'medium', 'high', 'xhigh', 'max'],
        inServerDefault: 'off',
      },
    });
    expect(levelsOf(env, 'pi', 'relay')).toEqual({
      'glm-5.3': {
        task: ['low', 'high', 'max'],
        taskDefault: 'high',
        inServer: ['low', 'high', 'max'],
      },
    });
    expect(levelsOf(env, 'devin')).toEqual({
      'swe-2-high': { task: ['medium', 'high', 'max'], taskDefault: 'high' },
      'claude-opus-5-5-medium': { task: claude },
      'gpt-6-sol-medium': {
        task: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
        taskDefault: 'medium',
      },
      'custom-unrun-model': {},
    });
    s.dispose();
  });
});
