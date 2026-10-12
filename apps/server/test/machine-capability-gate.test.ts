// #1251 机器能力闸（server 面，ADR 0018 决策 4）：能力上报持久化 + claim
// 能力闸 + agent requiredCapabilities 写读面 + machine-fit 读面。
// 失败方式（先于实现固化）：
// 1. 上报持久化：enroll/presence 的 capabilities 位落 machine.capabilities 列
//    并随 record 读面透出（GET me / GET teams machines）。
// 2. 心跳红线（02 §5.4）：presence 的 capabilities 坏形状（类型错）→ 200
//    {ok:true}，旧值保留；缺省 → 200，旧值保留——坏字段永不打死心跳通道。
// 3. MCP 维闸：agent.requiredCapabilities.mcpServers 含 slug X，归属机上报
//    清单缺 X → claim 空手、步留 pending（别机装齐也抢不走——#1259 归属机
//    闸在前）；换绑到齐的机器即领。
// 4. 模型维闸：requiredCapabilities.models 含 id M，归属机 claudeCodeReport
//    的 models[].id 缺 M → 挡；换绑到含的 → 放行。
// 5. 未知快照 fail-open：机器从未上报 capabilities（老 daemon，列 null）→
//    能力闸放行（未知 ≠ 缺失；版本墙纪律 = 老 daemon 行为不变）。
//    claudeCodeReport null 对 models 维同律。
// 6. 零回归：agent 无 requiredCapabilities（null/缺省）→ 闸恒开，现行为
//    完全不变。
// 7. 候选级 continue：被挡候选不队头阻塞同批其它候选（agent 并发闸同形）。
// 8. chief 步同律：chief 绑定 Agent 的能力要求进 buildChiefClaim 闸。
// 9. agent 写读面：POST/PATCH requiredCapabilities 落库即生效、record 随行；
//    显式 null = 清空；类型错 = 400。
// 10. machine-fit 读面：canRun = runtimeOk ∧ 能力不缺；missing null = 未上报
//     快照（fail-open 显示面同律）；mcpGaps = agent.mcpServers 声明对账
//     （可见不挡）。

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bindAgentHome,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seqCounter = 9_850;

interface World {
  s: TestServer;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 100 });
  disposables.push(() => s.dispose());
  const projectId = await postProject(s.app, 'capgate-proj');
  return { s, projectId };
}

/** REST enroll（可带 capabilities 位——老 daemon 形 = 不带）。返回
 *  {machineId, token}；online/enabledRuntimes 直写 DB（生产置位路径归
 *  presence/SSE 面测试，sweep 测试同律直写）。
 *  每台机器发独立 API key——enroll 按 (apiKeyId, teamId) 认机器（重注册复用
 *  同一 machineId，r3 §1.2），共用一把 key 会把多台机器折叠成同一行。 */
async function enrollMachineRest(
  w: World,
  opts: {
    name: string;
    capabilities?: unknown;
    online?: boolean;
    runtimes?: string[];
    claudeCodeModels?: string[];
  },
): Promise<{ machineId: string; token: string }> {
  const apiKey = await issueApiKey(w.s);
  const res = await w.s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      teamId: w.s.team.id,
      name: opts.name,
      cliVersion: '0.1.0',
      ...(opts.capabilities !== undefined ? { capabilities: opts.capabilities } : {}),
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { machineId: string; token: string };
  w.s.db
    .update(machineTable)
    .set({
      online: opts.online ?? true,
      enabledRuntimes: opts.runtimes ?? ['pi'],
      ...(opts.claudeCodeModels !== undefined
        ? {
            claudeCodeReport: {
              installed: true,
              hostname: opts.name,
              models: opts.claudeCodeModels.map((id) => ({ id, name: id })),
            },
          }
        : {}),
    })
    .where(eq(machineTable.id, body.machineId))
    .run();
  return body;
}

function insertAgent(
  w: World,
  opts: {
    id: string;
    requiredCapabilities?: { mcpServers?: string[]; models?: string[] } | null;
    mcpServers?: string[];
    modelId?: string | null;
    /** #1259 归属机（步的去处唯一位）；null = 未设（任何机器不可领）。 */
    home?: string | null;
  },
): void {
  w.s.db
    .insert(agentTable)
    .values({
      id: opts.id,
      teamId: w.s.team.id,
      displayName: opts.id,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: opts.modelId === undefined ? 'stub-model' : opts.modelId,
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: opts.mcpServers ?? [],
      maxConcurrentTasks: null,
      requiredCapabilities: opts.requiredCapabilities ?? null,
      machineId: opts.home ?? null,
    })
    .run();
}

/** 建 todo + build + pending build 步（assignment.build 指 agentId）。 */
function insertPendingStep(
  w: World,
  opts: { agentId: string },
): { stepId: string; buildId: string } {
  const suffix = Math.random().toString(36).slice(2, 8);
  seqCounter += 1;
  const now = seqCounter;
  const todoId = `todo-cap-${suffix}`;
  const buildId = `build-cap-${suffix}`;
  const stepId = `step-cap-${suffix}`;
  w.s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: w.s.team.id,
      projectId: w.projectId,
      seqNum: seqCounter,
      title: `能力闸任务 ${suffix}`,
      spec: '探针',
      phase: 'queued',
      phaseAt: now,
      assignment: { plan: null, build: { agentId: opts.agentId } },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: now,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: now + 1,
    })
    .run();
  return { stepId, buildId };
}

function machineDepsOf(w: World) {
  return {
    ...w.s.svc,
    box: w.s.secretBox,
    reposDir: w.s.reposDir,
    attachmentsDir: w.s.attachmentsDir,
    skillsDir: w.s.skillsDir,
  };
}

function claimAs(w: World, machineId: string) {
  return claimStep(machineDepsOf(w), machineId, w.s.team.id, 10, 'http://localhost');
}

function presenceAs(w: World, token: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    w.s.app.request('/api/machine/presence', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function stepRow(w: World, stepId: string) {
  return w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

describe('#1251 能力上报持久化 + 心跳红线', () => {
  test('失败方式 1：enroll 带 capabilities → 落列并随 record 透出', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-enroll',
      capabilities: { mcpServers: ['figma'], skills: ['verify-pacman'] },
    });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['figma'], skills: ['verify-pacman'] });
    // GET me 读面随行。
    const me = await w.s.app.request('/api/machine/me', {
      headers: { authorization: `Bearer ${m.token}` },
    });
    const meBody = (await me.json()) as { capabilities?: unknown };
    expect(meBody.capabilities).toEqual({ mcpServers: ['figma'], skills: ['verify-pacman'] });
    // team machines 列表读面随行。
    const list = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/machines`);
    const listBody = (await list.json()) as { machines?: unknown[] } | unknown[];
    const machines = Array.isArray(listBody) ? listBody : (listBody.machines ?? []);
    const mine = (machines as { id: string; capabilities?: unknown }[]).find(
      (r) => r.id === m.machineId,
    );
    expect(mine?.capabilities).toEqual({ mcpServers: ['figma'], skills: ['verify-pacman'] });
  });

  test('失败方式 1：presence 带 capabilities → 覆写落列', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-presence',
      capabilities: { mcpServers: [], skills: [] },
    });
    const res = await presenceAs(w, m.token, {
      cliVersion: '0.1.0',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['ctx'], skills: [] });
  });

  test('失败方式 2：presence capabilities 坏形状 → 200 {ok:true}，旧值保留（心跳红线）', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-tolerant',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    for (const bad of [{ mcpServers: 'oops' }, 42, 'x', [1], { mcpServers: [1], skills: [] }]) {
      const res = await presenceAs(w, m.token, { capabilities: bad });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['figma'], skills: [] });
  });

  test('失败方式 2：presence 缺省 capabilities → 200，旧值保留；从未上报 → 列 null', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-absent',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    const res = await presenceAs(w, m.token, { cliVersion: '0.1.0' });
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(machineTable).where(eq(machineTable.id, m.machineId)).get()!;
    expect(row.capabilities).toEqual({ mcpServers: ['figma'], skills: [] });
    // 老 daemon 形（enroll/presence 均不带）：列恒 null（≠ 空集）。
    const legacy = await enrollMachineRest(w, { name: 'cap-legacy' });
    const legacyRow = w.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.id, legacy.machineId))
      .get()!;
    expect(legacyRow.capabilities).toBeNull();
  });
});

describe('#1251 claim 能力闸', () => {
  test('失败方式 3：MCP 维——归属机缺 slug claim 空手留 pending（别机齐也抢不走），换绑到齐的即领', async () => {
    const w = await setupWorld();
    const lacking = await enrollMachineRest(w, {
      name: 'cap-lacking',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-capable',
      capabilities: { mcpServers: ['figma', 'ctx'], skills: [] },
    });
    insertAgent(w, {
      id: 'agent-cap-mcp',
      requiredCapabilities: { mcpServers: ['figma'] },
      home: lacking.machineId,
    });
    const { stepId } = insertPendingStep(w, { agentId: 'agent-cap-mcp' });

    // 归属机缺 slug → 能力闸挡；别机（齐）也领不到——归属机闸在前（#1259）。
    expect(await claimAs(w, lacking.machineId)).toBeNull();
    expect(await claimAs(w, capable.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');

    // 换绑到能力齐的机器 → 即领（换绑是一等公民出口）。
    bindAgentHome(w.s, 'agent-cap-mcp', capable.machineId);
    const claimed = await claimAs(w, capable.machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(stepRow(w, stepId).status).toBe('claimed');
  });

  test('失败方式 4：模型维——归属机 claudeCodeReport 缺模型 id 挡，换绑到含的放行', async () => {
    const w = await setupWorld();
    const noModel = await enrollMachineRest(w, {
      name: 'cap-model-no',
      capabilities: { mcpServers: [], skills: [] },
      claudeCodeModels: ['other-model'],
    });
    const hasModel = await enrollMachineRest(w, {
      name: 'cap-model-yes',
      capabilities: { mcpServers: [], skills: [] },
      claudeCodeModels: ['glm-5.3'],
    });
    insertAgent(w, {
      id: 'agent-cap-model',
      requiredCapabilities: { models: ['glm-5.3'] },
      home: noModel.machineId,
    });
    const { stepId } = insertPendingStep(w, { agentId: 'agent-cap-model' });
    expect(await claimAs(w, noModel.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
    bindAgentHome(w.s, 'agent-cap-model', hasModel.machineId);
    expect((await claimAs(w, hasModel.machineId))?.step.id).toBe(stepId);
  });

  test('失败方式 5：未上报快照 fail-open——老 daemon 机器照领', async () => {
    const w = await setupWorld();
    const legacy = await enrollMachineRest(w, { name: 'cap-open-legacy' }); // 无 capabilities
    insertAgent(w, {
      id: 'agent-cap-open',
      requiredCapabilities: { mcpServers: ['figma'] },
      home: legacy.machineId,
    });
    const { stepId } = insertPendingStep(w, { agentId: 'agent-cap-open' });
    expect((await claimAs(w, legacy.machineId))?.step.id).toBe(stepId);
  });

  test('失败方式 5：models 维对 claudeCodeReport null 同律 fail-open', async () => {
    const w = await setupWorld();
    const noReport = await enrollMachineRest(w, {
      name: 'cap-open-noreport',
      capabilities: { mcpServers: [], skills: [] },
      // claudeCodeModels 缺省 = claudeCodeReport 列 null
    });
    insertAgent(w, {
      id: 'agent-cap-open2',
      requiredCapabilities: { models: ['glm-5.3'] },
      home: noReport.machineId,
    });
    const { stepId } = insertPendingStep(w, { agentId: 'agent-cap-open2' });
    expect((await claimAs(w, noReport.machineId))?.step.id).toBe(stepId);
  });

  test('失败方式 6：零回归——无 requiredCapabilities 的 agent 行为不变', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-regress',
      capabilities: { mcpServers: [], skills: [] },
    });
    insertAgent(w, { id: 'agent-cap-none', home: m.machineId });
    const { stepId } = insertPendingStep(w, { agentId: 'agent-cap-none' });
    expect((await claimAs(w, m.machineId))?.step.id).toBe(stepId);
  });

  test('失败方式 7：被挡候选不队头阻塞——同批后续合法候选照领', async () => {
    const w = await setupWorld();
    const m = await enrollMachineRest(w, {
      name: 'cap-hol',
      capabilities: { mcpServers: [], skills: [] },
    });
    // 同机两 agent（#1259：归属同机）：被挡的缺 figma、自由的零要求。
    insertAgent(w, {
      id: 'agent-cap-blocked',
      requiredCapabilities: { mcpServers: ['figma'] },
      home: m.machineId,
    });
    insertAgent(w, { id: 'agent-cap-free', home: m.machineId });
    // 更早的候选 = 被挡 agent；更晚的候选 = 无要求 agent。
    const blocked = insertPendingStep(w, { agentId: 'agent-cap-blocked' });
    const free = insertPendingStep(w, { agentId: 'agent-cap-free' });
    const claimed = await claimAs(w, m.machineId);
    expect(claimed?.step.id).toBe(free.stepId);
    expect(stepRow(w, blocked.stepId).status).toBe('pending');
  });

  test('失败方式 8：chief 步同律——绑定 Agent 缺能力不领，换绑到齐的领', async () => {
    const w = await setupWorld();
    const lacking = await enrollMachineRest(w, {
      name: 'cap-chief-no',
      capabilities: { mcpServers: [], skills: [] },
    });
    const capable = await enrollMachineRest(w, {
      name: 'cap-chief-yes',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    insertAgent(w, {
      id: 'agent-cap-chief',
      requiredCapabilities: { mcpServers: ['figma'] },
      home: lacking.machineId,
    });
    const suffix = Math.random().toString(36).slice(2, 8);
    const now = Date.now();
    const chiefId = `chief-cap-${suffix}`;
    const threadId = `chief-thread-cap-${suffix}`;
    const stepId = `step-chief-cap-${suffix}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: 'agent-cap-chief',
        charter: '',
        createdAt: now,
      })
      .run();
    w.s.db
      .insert(chiefThreadTable)
      .values({
        id: threadId,
        chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        title: '能力闸 chief 线程',
        createdAt: now,
        updatedAt: now,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: now,
        pendingSessionResumeAt: null,
        toolDefHashes: {},
        toolResultHashes: {},
        activeRun: { phase: 'chief' },
      })
      .run();
    w.s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId: threadId,
        kind: 'chief',
        machineId: null,
        status: 'pending',
        prompt: '帮我看看',
        createdAt: now + 1,
      })
      .run();
    expect(await claimAs(w, lacking.machineId)).toBeNull();
    expect(stepRow(w, stepId).status).toBe('pending');
    bindAgentHome(w.s, 'agent-cap-chief', capable.machineId);
    expect((await claimAs(w, capable.machineId))?.step.id).toBe(stepId);
  });
});

describe('#1251 agent requiredCapabilities 写读面', () => {
  test('失败方式 9：POST 创建带位、PATCH 改写、显式 null 清空、类型错 400', async () => {
    const w = await setupWorld();
    // #1259：创建必填归属机（钉选退役后机器归属单源在 agent 层）。
    const home = await enrollMachineRest(w, { name: 'cap-create-home' });
    const created = await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/agents`, {
      displayName: 'cap-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: home.machineId,
      requiredCapabilities: { mcpServers: ['figma'] },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const got = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/${id}`);
    expect(((await got.json()) as { requiredCapabilities?: unknown }).requiredCapabilities).toEqual(
      { mcpServers: ['figma'] },
    );

    const patched = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${id}`, {
      requiredCapabilities: { models: ['glm-5.3'] },
    });
    expect(patched.status).toBe(200);
    const got2 = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/${id}`);
    expect(
      ((await got2.json()) as { requiredCapabilities?: unknown }).requiredCapabilities,
    ).toEqual({ models: ['glm-5.3'] });

    const cleared = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${id}`, {
      requiredCapabilities: null,
    });
    expect(cleared.status).toBe(200);
    const got3 = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/${id}`);
    expect(
      ((await got3.json()) as { requiredCapabilities?: unknown }).requiredCapabilities ?? null,
    ).toBeNull();

    const bad = await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/agents/${id}`, {
      requiredCapabilities: { mcpServers: 'figma' },
    });
    expect(bad.status).toBe(400);
  });

  test('失败方式 9：members 列表读面随行（agent 列表 = members 内嵌 actor）', async () => {
    const w = await setupWorld();
    insertAgent(w, { id: 'agent-cap-members', requiredCapabilities: { mcpServers: ['ctx'] } });
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/members`);
    const body = (await res.json()) as {
      memberType: string;
      actor?: { id: string; requiredCapabilities?: unknown };
    }[];
    const row = body.find((m) => m.actor?.id === 'agent-cap-members');
    expect(row?.actor?.requiredCapabilities).toEqual({ mcpServers: ['ctx'] });
  });
});

describe('#1251 machine-fit 读面（agent 面「哪些机器可跑它」）', () => {
  test('失败方式 10：canRun/missing/mcpGaps/runtimeOk 四态', async () => {
    const w = await setupWorld();
    insertAgent(w, {
      id: 'agent-fit',
      requiredCapabilities: { mcpServers: ['figma'] },
      mcpServers: ['figma', 'ctx'],
    });
    const capable = await enrollMachineRest(w, {
      name: 'fit-capable',
      capabilities: { mcpServers: ['figma'], skills: [] },
    });
    const lacking = await enrollMachineRest(w, {
      name: 'fit-lacking',
      capabilities: { mcpServers: ['ctx'], skills: [] },
    });
    const legacy = await enrollMachineRest(w, { name: 'fit-legacy' }); // 未上报快照
    const noRuntime = await enrollMachineRest(w, {
      name: 'fit-noruntime',
      capabilities: { mcpServers: ['figma'], skills: [] },
      runtimes: [], // pi 关 = runtime 闸挡
    });

    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/agents/agent-fit/machine-fit`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      machines: {
        machineId: string;
        name: string;
        online: boolean;
        runtimeOk: boolean;
        missing: string[] | null;
        mcpGaps: string[] | null;
        canRun: boolean;
      }[];
    };
    const byId = Object.fromEntries(body.machines.map((m) => [m.machineId, m]));

    // 能力齐 + runtime 开 → canRun；声明对账缺 ctx。
    expect(byId[capable.machineId]).toMatchObject({
      runtimeOk: true,
      missing: [],
      canRun: true,
      mcpGaps: ['ctx'],
    });
    // 缺 figma → 挡，missing 点名可读形。
    expect(byId[lacking.machineId]).toMatchObject({
      runtimeOk: true,
      missing: ['MCP server "figma"'],
      canRun: false,
      mcpGaps: ['figma'],
    });
    // 未上报快照 → 未知放行（fail-open），missing/mcpGaps null（显示面闭嘴）。
    expect(byId[legacy.machineId]).toMatchObject({
      runtimeOk: true,
      missing: null,
      mcpGaps: null,
      canRun: true,
    });
    // runtime 闸挡 → canRun false（能力面齐也挡；两闸独立）。
    expect(byId[noRuntime.machineId]).toMatchObject({ runtimeOk: false, canRun: false });
  });
});
