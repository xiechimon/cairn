// model-sources 端点对拍（spec 11 §A3/A4 + 数据契约，#356；#707 起
// claude-code 段跟随执行机）：GET /api/teams/:id/model-sources → pi 一段 +
// 每台上报过的机器一段 claude-code——pi 段 = custom providers models[]
// 投影（installed 恒 true）；claude-code 段 = daemon 经 enroll/presence
// 上行的本机 settings.json 解析结果（server 按机器聚合，不读本机文件）。
// 失败方式（先于实现固化）：
// F1 控制面配置不泄漏：上报值 ≠ server 本机值时，封套只含上报值。
// F2 多机：两台机器各一段 + hostname 如实（按机器名排序）。
// F3 无 claude-code 的机器：installed:false 段在、models 空。
// F6 旧 daemon（从未上报）：段缺席，封套仍合法。
// presence 更新即反映（30s 节拍实时语义的 server 侧）。

import { hostname } from 'node:os';
import { modelSourcesEnvelopeSchema } from '@pacman/shared';
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

/** 注册一台机器换 token（machine wire 面）。 */
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

describe('getModelSources（服务层，按机器聚合）', () => {
  test('全新库：仅 pi 一段（无上报机器时无 claude-code 段），封套过 shared schema', () => {
    const s = bootServer();
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(modelSourcesEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(env.sources.map((src) => src.runtime)).toEqual(['pi']);
    expect(env.sources[0]?.installed).toBe(true);
    expect(env.sources[0]?.hostname).toBe(hostname());
    expect(env.sources[0]?.models).toEqual([]);
    s.dispose();
  });

  test('pi 段 = custom providers models[] 投影（id/name 原样，跨 provider 平铺）', async () => {
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

  test('F1：执行机上报值进段——server 本机文件不读，段 hostname/模型 = 上报值', async () => {
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

  test('F2：两台机器各一段 + hostname 如实（按机器名排序）', async () => {
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

  test('F3：无 claude-code 的机器报 installed:false（段在、models 空）', async () => {
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

  test('F6：从未上报的机器（旧 daemon）缺席——enroll 不带 claudeCode 即无段', async () => {
    const s = bootServer();
    await enroll(s, 'legacy-1');
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    expect(env.sources.map((src) => src.runtime)).toEqual(['pi']);
    s.dispose();
  });

  test('F7（#1050）：bin/auth 原样透传——server 不合成、不猜', async () => {
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

  test('F8（#1050）：旧形状（无 bin/auth）→ 两键缺席，不写「未知」', async () => {
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

  test('presence 更新即反映：改上报后内容立即变（30s 节拍实时语义）', async () => {
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

  test('enroll 即带上报：首个 presence 前已有段', async () => {
    const s = bootServer();
    await enroll(s, 'exec-1', report('exec-host-1', [{ id: 'm-early', name: 'm-early' }]));
    const env = getModelSources({ db: s.db, box: s.secretBox }, s.team.id);
    const cc = env.sources.find((src) => src.runtime === 'claude-code');
    expect(cc?.models).toEqual([{ id: 'm-early', name: 'm-early' }]);
    s.dispose();
  });
});

describe('GET /api/teams/:id/model-sources（路由面）', () => {
  test('未知 team → 404 error 形', async () => {
    const s = bootServer();
    const res = await req(s.app, 'GET', '/api/teams/nope/model-sources');
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['error']);
    s.dispose();
  });

  test('200：pi 首段 + 上报机段 + 元素形状', async () => {
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
