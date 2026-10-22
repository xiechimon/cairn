// 机器面协议逐字段对拍（04 §3 wire 层进 CI；真值 = 02 §5 canonical + r3 §1
// 实测语义）。单源 = shared MACHINE_ENDPOINTS / MACHINE_WIRE + zod schema：
// 每个响应逐字段过 schema parse（不判负口径见 04 §3——[推断]/[设计] 面在
// shared machine-wire.ts 注释登记）。claim/wake 时序对照 r3 §1.5（~75s 长轮询
// 节奏 + wake 低延迟派发）以缩短时标实测同构。

import { createHash } from 'node:crypto';
import {
  CLAIM_POLL_INTERVAL_MS,
  type ClaimedStep,
  claimedStepSchema,
  MACHINE_ENDPOINTS,
  MACHINE_WIRE,
  MACHINE_WIRE_EXTENSIONS,
  MERGE_ANNOUNCEMENT,
  machineClaimResponseSchema,
  machineEnrollResponseSchema,
  machineOkResponseSchema,
  machineRecordSchema,
  machineRecoverResponseSchema,
  machineStreamEventSchema,
  machineTokenResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  agent as agentTable,
  build as buildTable,
  machine as machineTable,
  message as messageTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
  tokenUsage,
} from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; text?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.text,
    }),
  );
}

const AGENT_ID = 'agent-stub-1';

interface World {
  s: TestServer;
  /** 注册用 API key 明文（重注册复用同一 machineId = 按 key/team 认机器，r3 §1.2）。 */
  apiKey: string;
  token: string;
  machineId: string;
  projectId: string;
  todoId: string;
  startBuild(withPlan?: boolean): Promise<{ buildId: string }>;
  claim(): Promise<{ res: Response; body: { step: ClaimedStep | null } }>;
}

async function setupWorld(
  opts: { claimHoldMs?: number; pingIntervalMs?: number } = {},
): Promise<World> {
  const s = bootServer({
    claimHoldMs: opts.claimHoldMs ?? 250,
    pingIntervalMs: opts.pingIntervalMs ?? 3_600_000,
  });
  // 机器注册 key 走 M2c 发行端点（一次性明文，02 §8/r3 §6）。
  const key = { plain: await issueApiKey(s) };
  // custom provider（r3 §2 记录形状；无 key 网关可留空 = apiKeyCipher null）。
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-1',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  // enroll（02 §5.2 路径二：--api-key --team）。
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key.plain,
    body: { teamId: s.team.id, name: 'test-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  expect(enrollRes.status).toBe(200);
  const machineJson = machineEnrollResponseSchema.parse(await enrollRes.json());
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '探针任务', spec: '写一行探针到 README.md' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  return {
    s,
    apiKey: key.plain,
    token: machineJson.token,
    machineId: machineJson.machineId,
    projectId,
    todoId: todoBody.id,
    async startBuild(withPlan = true) {
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoBody.id],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan,
        },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { builds: { id: string }[] };
      return { buildId: body.builds[0]!.id };
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineJson.token,
        body: {},
      });
      return { res, body: (await res.json()) as { step: ClaimedStep | null } };
    },
  };
}

function normalizePath(path: string): string {
  return path.replaceAll(/:([A-Za-z]+)/g, '{$1}');
}

describe('机器面路由 = 02 §5 词表（13 端点单源对拍）', () => {
  const s = bootServer();
  // 命名空间 = /api/machine/ 单数（daemon 协议面）；/api/machines 复数是 web
  // 资源面（#357 PATCH），前缀裸匹配会误吞——钉斜杠边界。
  const have = new Set(
    s.app.routes
      .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/machine/'))
      .map((r) => `${r.method} ${normalizePath(r.path)}`),
  );

  test('实现面覆盖 MACHINE_WIRE 全部 13 端点（动词+路径逐一）', () => {
    for (const w of MACHINE_WIRE) {
      expect(have.has(`${w.method} ${w.path}`), `${w.method} ${w.path}`).toBe(true);
    }
    expect(MACHINE_WIRE).toHaveLength(13);
    expect(MACHINE_ENDPOINTS.map((e) => e.path)).toEqual(MACHINE_WIRE.map((w) => w.path));
  });

  test('词表外仅登记 [设计] 附加端点（单源 = shared MACHINE_WIRE_EXTENSIONS）', () => {
    const wire = new Set(MACHINE_WIRE.map((w) => `${w.method} ${w.path}`));
    const extra = [...have].filter((r) => !wire.has(r));
    expect(extra).toEqual(MACHINE_WIRE_EXTENSIONS.map((e) => `${e.method} ${e.path}`));
  });

  test('生产默认 claim hold = 75s（r3 §1.5 ~75–76s 节奏；wire 常量单源）', () => {
    expect(CLAIM_POLL_INTERVAL_MS).toBe(75_000);
    expect(loadConfig().claimHoldMs).toBe(CLAIM_POLL_INTERVAL_MS);
  });
});

describe('enroll / me / presence / recover（02 §5.2–§5.4）', () => {
  test('无凭证或坏凭证 = 401 {error}（错误形状 r5 §1 族）', async () => {
    const w = await setupWorld();
    for (const res of [
      await call(w.s.app, 'GET', '/api/machine/me'),
      await call(w.s.app, 'GET', '/api/machine/me', { cred: 'deadbeef' }),
      await call(w.s.app, 'POST', '/api/machine/enroll', {
        cred: 'pacman_nope',
        body: { teamId: w.s.team.id },
      }),
    ]) {
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['error']);
    }
  });

  test('重注册复用同一 machineId（r3 §1.2 实测：logout 后重注册不变）', async () => {
    const w = await setupWorld();
    // 同 key 重注册（r3 §1.2：logout 后 `tds start --api-key` 复用 machineId）。
    const res = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: w.apiKey,
      body: { teamId: w.s.team.id, name: 'test-mbp', cliVersion: '0.1.0' },
    });
    const again = machineEnrollResponseSchema.parse(await res.json());
    expect(again.machineId).toBe(w.machineId);
    expect(again.token).not.toBe(w.token); // 新 token（旧哈希被替换）
    // 旧 token 立即失效（服务端只存哈希，02 §8）。
    expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).status).toBe(401);
    expect((await call(w.s.app, 'GET', '/api/machine/me', { cred: again.token })).status).toBe(200);
  });

  test('me = machine record 逐字段（02 §6.2）', async () => {
    const w = await setupWorld();
    const res = await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token });
    const record = machineRecordSchema.parse(await res.json());
    expect(record).toMatchObject({
      id: w.machineId,
      name: 'test-mbp',
      teamId: w.s.team.id,
      latestCliVersion: '0.1.0',
    });
  });

  test('presence 置 online + team stream machine_presence 事件（02 §1.2）', async () => {
    const w = await setupWorld();
    const streamP = (async () => {
      const ctrl = new AbortController();
      const res = await w.s.app.request(`/api/teams/${w.s.team.id}/stream`, {
        signal: ctrl.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (ev.type === 'machine_presence') {
              ctrl.abort();
              return ev;
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
      return null;
    })();
    const res = await call(w.s.app, 'POST', '/api/machine/presence', {
      cred: w.token,
      body: { cliVersion: '0.1.0' },
    });
    expect(machineOkResponseSchema.parse(await res.json())).toEqual({ ok: true });
    const ev = await streamP;
    expect(ev).toMatchObject({
      type: 'machine_presence',
      machineId: w.machineId,
      online: true,
    });
    const me = machineRecordSchema.parse(
      await (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).json(),
    );
    expect(me.online).toBe(true);
  });

  test('recover 初始空集（r3 §1.5 `[recover] no pending steps found` 行语义）', async () => {
    const w = await setupWorld();
    const res = await call(w.s.app, 'POST', '/api/machine/recover', { cred: w.token });
    expect(machineRecoverResponseSchema.parse(await res.json())).toEqual({ steps: [] });
  });
});

describe('claim/wake 时序（r3 §1.5 对照：~75s 长轮询节奏 + wake 低延迟派发）', () => {
  test('空手长轮询 ≈ hold 时长后返回 {step:null}（节奏同构，时标缩短）', async () => {
    const w = await setupWorld({ claimHoldMs: 400 });
    const t0 = Date.now();
    const { res, body } = await w.claim();
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(machineClaimResponseSchema.parse(body)).toEqual({ step: null });
    expect(elapsed).toBeGreaterThanOrEqual(380);
    expect(elapsed).toBeLessThan(3_000);
  });

  test('入队即 wake：挂起的 claim 立即领取（远小于 hold = 低延迟派发）', async () => {
    const w = await setupWorld({ claimHoldMs: 30_000 });
    const t0 = Date.now();
    const claimP = w.claim();
    const { buildId } = await w.startBuild(true);
    const { body } = await claimP;
    const elapsed = Date.now() - t0;
    const step = claimedStepSchema.parse(body.step);
    expect(step.step.buildId).toBe(buildId);
    expect(elapsed).toBeLessThan(3_000); // wake 路径 ≪ 30s hold
  });

  // #1217 missed-wake 补醒（hub 契约）：claim 面检查与武装 waitWake 之间出现
  // 微任务缝（tryClaim 异步化），wake 落在缝里时纯 pubsub 丢事件 → claim 睡满
  // hold。基线之后的 wake 由 waitWake(sinceSeq) 即刻补醒——不依赖 claimStep
  // 内部时序成立。
  test('#1217 missed-wake 补醒：基线后 wake 先于武装 → waitWake 即刻返回', async () => {
    const s = bootServer();
    const since = s.machineHub.wakeSeq(s.team.id);
    s.machineHub.wake(s.team.id); // 缝内 wake：基线已取、waitWake 未武装
    const t0 = Date.now();
    const woken = await s.machineHub.waitWake(s.team.id, 30_000, undefined, since);
    expect(woken).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1_000);
    // 无基线（老调用形）仍纯等待：同缝内 wake 不补醒（缺省语义不变）。
    const bare = s.machineHub.waitWake(s.team.id, 50);
    const wokenBare = await bare;
    expect(wokenBare).toBe(false);
    s.dispose();
  });

  test('machine stream SSE 推送 wake 事件（02 §1.2 机器通道）', async () => {
    const w = await setupWorld({ claimHoldMs: 30_000 });
    const ctrl = new AbortController();
    const res = await w.s.app.request('/api/machine/stream', {
      headers: { authorization: `Bearer ${w.token}` },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const readWake = (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        buf += decoder.decode(value, { stream: true });
        // SSE 帧 = `data: <json>\n\n`（帧解析与 helpers.openStream 同构）。
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5).trim()) as { type?: string };
            if (ev.type === 'wake') return ev;
          }
          idx = buf.indexOf('\n\n');
        }
      }
    })();
    // 等订阅生效再入队（stream 建立为异步）。
    for (let i = 0; i < 100 && w.s.machineHub.streamCount(w.s.team.id) === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await w.startBuild(true);
    const ev = await readWake;
    ctrl.abort();
    expect(machineStreamEventSchema.parse(ev)).toEqual({ type: 'wake' });
  });

  test('#863 机器通道保活：SSE 注释帧按 pingInterval 心跳（无事件机器的流不再被客户端 bodyTimeout 静默掐断 → machine.online 不闪断 → 会话亲和闸的判据不误放行）', async () => {
    const w = await setupWorld({ claimHoldMs: 200, pingIntervalMs: 80 });
    const ctrl = new AbortController();
    const res = await w.s.app.request('/api/machine/stream', {
      headers: { authorization: `Bearer ${w.token}` },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    // 物理故障形态（#863 实跑撞上）：机器 SSE 无事件可发时连接零字节，undici
    // bodyTimeout（默认 300s，按 body 数据间隔计）掐流 → server onAbort
    // markOffline → online 闪断至下一次 presence（≤30s）。会话亲和闸按
    // online 即时判定，闪断窗口内把他机放行 = 无谓换机。修法 = 注释帧保活
    // （SSE 规范注释行；daemon 帧解析只认 data: 前缀行，注释行零解析面）。
    let buf = '';
    let sawComment = false;
    const deadline = Date.now() + 5_000;
    read: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (frame.split('\n').some((line) => line.startsWith(':'))) {
          sawComment = true;
          break read;
        }
        idx = buf.indexOf('\n\n');
      }
      if (Date.now() > deadline) break;
    }
    ctrl.abort();
    expect(sawComment).toBe(true);
  });
});

describe('步骤 journal 全链（02 §5.4 词表 + §4.2 主时序机器侧）', () => {
  test('claim→heartbeat→tool→token→upload-urls→transcript→done→confirm→continue→review→merge→done 全链逐字段', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    const cred = { cred: w.token };
    const { buildId } = await w.startBuild(true);

    // —— 规划步 claim（02 §5.7 `claim step=<id>`）——
    const { body: claim1 } = await w.claim();
    const claimed = claimedStepSchema.parse(claim1.step);
    expect(claimed.step.kind).toBe('plan');
    expect(claimed.conversationId).toBe(buildId); // buildId ≡ conversationId
    expect(claimed.session).toEqual({ action: 'new', sessionId: null });
    expect(claimed.todo).toMatchObject({ id: w.todoId, seqNum: 1, title: '探针任务' });
    expect(claimed.agent).toMatchObject({
      id: AGENT_ID,
      provider: 'stub-gw',
      modelId: 'stub-model',
    });
    const stepId = claimed.step.id;
    // claim 即 phase 推进 queued→planning（phase.ts 边集，02 §4.2）。
    const todoNow = () => w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoNow().phase).toBe('planning');

    // —— heartbeat（02 §5.4 续活）——
    const hb = await call(w.s.app, 'POST', `/api/machine/heartbeat/${stepId}`, {
      ...cred,
      body: {},
    });
    expect(machineOkResponseSchema.parse(await hb.json())).toEqual({ ok: true });

    // —— tool live 回传（transcript 工具行，r3 §3.5）——
    const toolCall = {
      id: 'call-1',
      name: 'edit',
      arguments: { path: 'README.md' },
      result: { content: 'ok' },
      isError: false,
      startedAt: Date.now(),
      endedAt: Date.now(),
    };
    const toolRes = await call(w.s.app, 'POST', `/api/machine/tool/${stepId}`, {
      ...cred,
      body: toolCall,
    });
    expect(machineOkResponseSchema.parse(await toolRes.json())).toEqual({ ok: true });

    // —— token（per-step 凭证下发，02 §5.4/§8）——
    const tokenRes = await call(w.s.app, 'GET', `/api/machine/token/${stepId}`, cred);
    const token = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(token.provider).toMatchObject({
      kind: 'http',
      providerId: 'stub-gw',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
    });
    expect(token.secrets).toEqual({}); // 团队密钥取用面（agent.secrets 空 → 空映射，02 §8）
    expect(token.git).toBeNull(); // 托管 repo git 凭证槽（credentials.ts：接线随 git 面）

    // —— upload-urls + transcript 终稿落库（02 §1.3 数据所有权）——
    const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      ...cred,
      body: { files: [{ name: 'transcript.json' }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    expect(urls.uploads).toHaveLength(1);
    const upload = urls.uploads[0]!;
    expect(upload.method).toBe('PUT');
    const putRes = await call(w.s.app, 'PUT', upload.url.replace(/^https?:\/\/[^/]+/, ''), {
      ...cred,
      body: {
        stepId,
        messages: [
          // 与 tool live 行同 id = 幂等去重（[设计]）。
          {
            id: 'call-1',
            role: 'assistant',
            content: { kind: 'toolcall', call: { ...toolCall, result: { content: 'final' } } },
            createdAt: Date.now(),
          },
          {
            id: 'msg-1',
            role: 'assistant',
            content: { kind: 'text', text: '方案已写入 plan.md' },
            createdAt: Date.now(),
          },
        ],
      },
    });
    expect(machineOkResponseSchema.parse(await putRes.json())).toEqual({ ok: true });
    const rows = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(rows).toHaveLength(2); // call-1 去重 + msg-1
    const toolRow = rows.find((r) => r.id === 'call-1')!;
    expect((toolRow.content as { call: { result: { content: string } } }).call.result.content).toBe(
      'final',
    );
    // 一次性：同 uploadId 再用 = 404。
    expect(
      (
        await call(w.s.app, 'PUT', upload.url.replace(/^https?:\/\/[^/]+/, ''), {
          ...cred,
          body: { stepId, messages: [] },
        })
      ).status,
    ).toBe(404);

    // —— plan.md 产物回传（02 §4.2「plan 即文件」交接物；#113：无产物规划步
    // 不算成、不进 confirm）——
    const planUrlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      ...cred,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const planUpload = machineUploadUrlsResponseSchema.parse(await planUrlsRes.json()).uploads[0]!;
    const planPut = await call(w.s.app, 'PUT', planUpload.url.replace(/^https?:\/\/[^/]+/, ''), {
      ...cred,
      text: '# 方案\nContext: 探针\n',
      contentType: 'text/markdown',
    });
    expect(machineOkResponseSchema.parse(await planPut.json())).toEqual({ ok: true });

    // —— done（收尾 + 记账 + phase 推进 planning→confirm）——
    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      ...cred,
      body: {
        status: 'success',
        sessionId: 'pi-session-1',
        usage: [
          { model: 'stub-gw/stub-model', input: 12, output: 980, cacheRead: 100, cacheWrite: 50 },
        ],
        hasChanges: true,
      },
    });
    expect(machineOkResponseSchema.parse(await doneRes.json())).toEqual({ ok: true });
    expect(todoNow().phase).toBe('confirm');
    const usage = w.s.db.select().from(tokenUsage).all();
    expect(usage).toEqual([
      {
        buildId,
        model: 'stub-gw/stub-model',
        input: 12,
        output: 980,
        cacheRead: 100,
        cacheWrite: 50,
        // 成本五列（#927）：done 上报不带 cost 位（旧 daemon / 无价格来源）
        // → 按 0 记账，四维零变化——mixed-version 兼容面的钉。带价路径的
        // 数值断言在 integration/test/pi-session-policy.test.ts。
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costCacheWrite: 0,
        costTotal: 0,
      },
    ]);

    // —— 确认 → 执行步 claim = continue session（02 §5.7 复用同 conv 会话）——
    const confirmRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(confirmRes.status).toBe(202);
    const { body: claim2 } = await w.claim();
    const step2 = claimedStepSchema.parse(claim2.step);
    expect(step2.step.kind).toBe('build');
    expect(step2.session).toEqual({ action: 'continue', sessionId: 'pi-session-1' });
    expect(todoNow().phase).toBe('building');

    // —— 执行步 done → review（02 §4.2）——
    await call(w.s.app, 'POST', `/api/machine/done/${step2.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1', hasChanges: true },
    });
    expect(todoNow().phase).toBe('review');

    // —— merge 202 delegated → 合并步（02 §4.2/A6）→ done 终态 ——
    // XMON-77 权限闸：合并要求 build 槽 Agent 持 合并分支+推送分支 两开关
    //（默认全关 = 拒，专段钉 403 面）——满链路世界在发起合并前先授权。
    w.s.db
      .update(agentTable)
      .set({ tools: ['合并分支', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(202);
    expect(await mergeRes.json()).toEqual({ delegated: true });
    const { body: claim3 } = await w.claim();
    const step3 = claimedStepSchema.parse(claim3.step);
    expect(step3.step.kind).toBe('merge');
    expect(step3.session.action).toBe('continue');
    await call(w.s.app, 'POST', `/api/machine/done/${step3.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1' },
    });
    expect(todoNow().phase).toBe('done');
    // usage 累加幂等面：第二次 done 无 usage 不动账。
    expect(w.s.db.select().from(tokenUsage).all()).toHaveLength(1);
  });

  test('done failed → todo failed + build.errorMessage（02 §4.2 步级失败无自动重跑）', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    const { buildId } = await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    const res = await call(w.s.app, 'POST', `/api/machine/done/${claimed.step.id}`, {
      cred: w.token,
      body: { status: 'failed', errorMessage: '模型连接失败' },
    });
    expect(res.status).toBe(200);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toBe('模型连接失败');
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get()!;
    expect(stepRow.status).toBe('failed');
  });

  test('recover 返回本机 claimed 未收尾步（journal 恢复 server 侧真值）', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    const res = await call(w.s.app, 'POST', '/api/machine/recover', { cred: w.token });
    const recovered = machineRecoverResponseSchema.parse(await res.json());
    expect(recovered.steps.map((s) => s.id)).toEqual([claimed.step.id]);
  });

  test('他机步骤 = 404；未知步骤 = 410（错误形状 {error}）', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    // 第二台机器（同 key 重注册会复用 machineId——用直接 DB 行模拟他机）。
    w.s.db
      .insert(machineTable)
      .values({
        id: 'machine-other',
        teamId: w.s.team.id,
        name: 'other',
        online: false,
        tokenHash: createHash('sha256').update('other-token').digest('hex'),
        apiKeyId: null,
        latestCliVersion: null,
      })
      .run();
    const res = await call(w.s.app, 'POST', `/api/machine/heartbeat/${claimed.step.id}`, {
      cred: 'other-token',
      body: {},
    });
    expect(res.status).toBe(404);
    expect(Object.keys((await res.json()) as object)).toEqual(['error']);
    // 不存在的步 = 410（#1488：与被重置删掉的步同判，daemon 据此停掉在跑的会话）。
    const unknown = await call(w.s.app, 'POST', '/api/machine/heartbeat/nope', {
      cred: w.token,
      body: {},
    });
    expect(unknown.status).toBe(410);
  });

  test('#1488 卡被重置删掉了在跑的步 → 心跳 410；本机仍持有的步 → 200', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(true);
    const { body } = await w.claim();
    const claimed = claimedStepSchema.parse(body.step);
    const beat = () =>
      call(w.s.app, 'POST', `/api/machine/heartbeat/${claimed.step.id}`, {
        cred: w.token,
        body: {},
      });
    expect((await beat()).status).toBe(200);
    expect((await call(w.s.app, 'POST', `/api/todos/${w.todoId}/reset`, { body: {} })).status).toBe(
      200,
    );
    const gone = await beat();
    expect(gone.status).toBe(410);
    expect(Object.keys((await gone.json()) as object)).toEqual(['error']);
  });
});

describe('claim 载荷：agent.skillsAllowlist 授权 + defaultSkill 携带（#1169 拆字段）', () => {
  // 失败方式（先于实现固化）：
  // 1. null 与 [] 两态塌缩 → 「不限制」被读成「全拒」，新建 agent 出生即残废
  //    （本票主修位）——载荷必须把 null 与 [] 各自原样送达。
  // 2. 数组被过滤/重排 → 过滤权在 daemon catalog 构建，claim 面原样透传。
  // 3. chief 步误携带 → 信任面全量直通（daemon isChief 双保险）。
  // 4. defaultSkill 不随 claim 下发 → daemon 注入绑定序无从排首位（#1116 面）。

  async function claimWith(opts: {
    defaultSkill?: string | null;
    skillsAllowlist?: string[] | null;
  }): Promise<ClaimedStep | null> {
    const w = await setupWorld({ claimHoldMs: 200 });
    w.s.db
      .update(agentTable)
      .set({ ...opts })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    await w.startBuild(false);
    const { body } = await w.claim();
    const step = body.step ? claimedStepSchema.parse(body.step) : null;
    w.s.dispose();
    return step;
  }

  test('勾选子集原样携带（worker 步，不过滤不重排——过滤权在 daemon catalog 构建）', async () => {
    const step = await claimWith({ defaultSkill: 'alpha', skillsAllowlist: ['alpha', 'ghost'] });
    expect(step).not.toBeNull();
    expect(step!.agent?.skillsAllowlist).toEqual(['alpha', 'ghost']);
    expect(step!.agent?.defaultSkill).toBe('alpha');
  });

  test('null（不限制）与 []（显式全拒）各自原样携带——两态不得塌缩', async () => {
    const unrestricted = await claimWith({ defaultSkill: null, skillsAllowlist: null });
    expect(unrestricted).not.toBeNull();
    expect(unrestricted!.agent?.skillsAllowlist).toBeNull();
    expect(unrestricted!.agent?.defaultSkill).toBeNull();
    const denyAll = await claimWith({ skillsAllowlist: [] });
    expect(denyAll).not.toBeNull();
    expect(denyAll!.agent?.skillsAllowlist).toEqual([]);
  });

  test('从未设置的 agent 行（列缺省）= 携带 null（不限制——创建缺省即本票默认，不再是 [] 全拒）', async () => {
    const w = await setupWorld({ claimHoldMs: 200 });
    await w.startBuild(false);
    const { body } = await w.claim();
    const step = body.step ? claimedStepSchema.parse(body.step) : null;
    expect(step).not.toBeNull();
    // 列缺省 NULL：新建 agent 出生即不限制（#1169 主修位）。
    expect(step!.agent?.skillsAllowlist).toBeNull();
    expect(step!.agent?.defaultSkill).toBeNull();
    w.s.dispose();
  });
});

describe('claim 载荷：agent.tools 权限开关集透传（XMON-77）', () => {
  // 失败方式（先于实现固化）：
  // 1. 勾选集不随 claim 下发 → daemon 收尾闸无从判推送/合并权限（开关摆设）。
  // 2. 全关（[]）缺省不携带 → daemon 只能把缺省当 fail-open，全关 agent 被迫
  //    落进「老 server」豁免面——与 skills 同律：worker 步恒携带含空数组。
  // 3. 透传时过滤/改名 → 存量行残值（如退役的 远程 shell）被 server 静默吞掉，
  //    执法权应在 daemon 收尾闸（只认已知档，残值自然无效）。

  async function claimWithTools(tools: string[]): Promise<ClaimedStep | null> {
    const w = await setupWorld({ claimHoldMs: 200 });
    w.s.db.update(agentTable).set({ tools }).where(eq(agentTable.id, AGENT_ID)).run();
    await w.startBuild(false);
    const { body } = await w.claim();
    const step = body.step ? claimedStepSchema.parse(body.step) : null;
    w.s.dispose();
    return step;
  }

  test('已开集原样携带（读侧宽：存量残值也透传，过滤权不在 claim 面）', async () => {
    const step = await claimWithTools(['推送分支', '远程 shell']);
    expect(step).not.toBeNull();
    expect(step!.agent?.tools).toEqual(['推送分支', '远程 shell']);
  });

  test('全关 = 携带 []（least-privilege 与 skills 同律；缺省保留给老 server fail-open）', async () => {
    const step = await claimWithTools([]);
    expect(step).not.toBeNull();
    expect(step!.agent?.tools).toEqual([]);
  });
});

describe('merge 权限闸：requestMerge 校验 build 槽 Agent 两开关（XMON-77）', () => {
  // 失败方式（先于实现固化）：
  // 1. 全关 agent 发起合并 → 202 照发 + 合并步入队 → 步被 daemon 拒/挂死，
  //    用户在点击面看不到拒绝原因。应在 requestMerge 即 403 点名缺失开关。
  // 2. 403 后留半套副作用（合并步入队 / MERGE_ANNOUNCEMENT 时间线行 /
  //    phase 离开 review）→ 点击失败却污染状态机。
  // 3. 只持合并分支（缺推送）放行 → 三形态 repo 的落地都以 conv 分支 push
  //    为前置（local ff 落地、hosted applyMergeLanding 读推送态、github done
  //    语义即已推）——合并步必然在推送处失败，403 应在点击面点名推送分支。
  // 4. 403 吞掉错误形状（非 {error}）→ wire 契约漂移。

  /** 走到 review 相位（plan→confirm→build 主时序机器侧驱动，复用全链路面）。 */
  async function reachReview(): Promise<World> {
    const w = await setupWorld({ claimHoldMs: 200 });
    const cred = { cred: w.token };
    const { buildId } = await w.startBuild(true);
    const { body: claim1 } = await w.claim();
    const step1 = claimedStepSchema.parse(claim1.step);
    const planUrls = await call(w.s.app, 'POST', `/api/machine/upload-urls/${step1.step.id}`, {
      ...cred,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const planUpload = machineUploadUrlsResponseSchema.parse(await planUrls.json()).uploads[0]!;
    await call(w.s.app, 'PUT', planUpload.url.replace(/^https?:\/\/[^/]+/, ''), {
      ...cred,
      text: '# 方案\n',
      contentType: 'text/markdown',
    });
    await call(w.s.app, 'POST', `/api/machine/done/${step1.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1' },
    });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const { body: claim2 } = await w.claim();
    const step2 = claimedStepSchema.parse(claim2.step);
    await call(w.s.app, 'POST', `/api/machine/done/${step2.step.id}`, {
      ...cred,
      body: { status: 'success', sessionId: 'pi-session-1', hasChanges: true },
    });
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase).toBe(
      'review',
    );
    return w;
  }

  test('全关 agent（默认 []）→ 403 点名两开关；无合并步/无时间线行/相位停 review', async () => {
    const w = await reachReview();
    const buildId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, w.todoId))
      .get()!.id;
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(403);
    const errBody = (await mergeRes.json()) as { error: string };
    expect(Object.keys(errBody)).toEqual(['error']);
    expect(errBody.error).toContain('合并分支');
    expect(errBody.error).toContain('推送分支');
    // 半套副作用全无：无合并步、无 MERGE_ANNOUNCEMENT 行、相位不动。
    const steps = w.s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(steps.every((s) => s.kind !== 'merge')).toBe(true);
    const msgRows = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(msgRows.map((m) => m.content)).not.toContain(MERGE_ANNOUNCEMENT);
    expect(w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase).toBe(
      'review',
    );
    w.s.dispose();
  });

  test('只持合并分支（缺推送）→ 403 只点名推送分支（落地以推送为前置）', async () => {
    const w = await reachReview();
    w.s.db
      .update(agentTable)
      .set({ tools: ['合并分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const buildId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, w.todoId))
      .get()!.id;
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(403);
    const errBody = (await mergeRes.json()) as { error: string };
    expect(errBody.error).toContain('推送分支');
    w.s.dispose();
  });

  test('两开关齐 → 202 delegated（正路径钉在主时序全链测试）', async () => {
    const w = await reachReview();
    w.s.db
      .update(agentTable)
      .set({ tools: ['合并分支', '推送分支'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const buildId = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.todoId, w.todoId))
      .get()!.id;
    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(202);
    expect(await mergeRes.json()).toEqual({ delegated: true });
    w.s.dispose();
  });
});
