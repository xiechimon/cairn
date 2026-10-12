// 机器面远程 shell（XMON-108 R1）：双闸授权 + 每命令预检 + 审计状态机。
// 契约单源 = shared protocol/machine-wire.ts（machineShell* schema +
// LOCAL_TOOL_* 词值 + MACHINE_WIRE_EXTENSIONS 登记位）。
// 失败方式先于实现枚举（仓测试规则 3）：
// L. claim 组装 localTools（注册面）
//   L1. 双闸矩阵错判：agent「远程 shell」∩ machine.shellEnabled 任一组合下
//       remote_shell 词不在/误在（四组合逐一钉）。
//   L2. create_tag 误绑机器闸（leader 裁定：只判 agent 工具，与机器旗无关）。
//   L3. 全关时缺省不携带（应恒携带 []——缺省是 chief fail-open 语义面，
//       worker 必须显式空数组，两态不得混淆）。
//   L4. chief 步误带 localTools（chief 无 worktree/无本地工具语义）。
// P. PATCH /api/machines/{id} shellEnabled 透传
//   P1. 透传不走通 / 回显不一致（验收 #5 回读）。
//   P2. 单字段 PATCH 撞掉 enabledRuntimes（缺省应 = 不变）。
//   P3. 空 body PATCH 炸（空 set 是非法 SQL）/ 未知 id 非 404。
//   P4. 非 boolean 值不 400（schema 钉形状）。
// C. 预检 POST /api/machine/shell/{stepId}
//   C1. 放行不落 running 审计行 / runId 不回 / 响应形漂。
//   C2. agent 拒绝不落 denied 行 / 403 不点「Agent 详情页权限 tab」。
//   C3. 机器拒绝同上（403 点机器名）。
//   C4. 步中关机器闸仍放行（claim 期快照被当永真——验收 #3：关闸下一条
//       命令立即拒，秒级热加载，非 claim 期一次闸）。
//   C5. 步中摘 agent 工具仍放行（双闸每调用重读）。
//   C6. 协议错：未领步/他机步非 404；已收尾步非 409；chief 步非 409。
//   C7. 坏 body（空 command / 超长 / 非 JSON）不 400。
// R. 回写 POST /api/machine/shell/{runId}/result
//   R1. 终态不落库（status/exitCode/output/finishedAt）。
//   R2. 重复回写改写终态（终态只写一次——网络重试幂等 200 不改写）。
//   R3. failed 回写丢 errorMessage / done 误落 errorMessage。
//   R4. denied 行回写被吞（应 409：denied 的 runId 从未下发）。
//   R5. 未知 runId 非 404 / 他机 runId 非 403（sync-result 同律）。
//   R6. 词表外 status（running/pending）不 400。
// M. migration：machine 行 shellEnabled 回填 false（存量行默认关）。

import {
  type ClaimedStep,
  claimedStepSchema,
  LOCAL_TOOL_CREATE_TAG,
  LOCAL_TOOL_REMOTE_SHELL,
  machineRecordSchema,
  machineShellPrecheckResponseSchema,
  SHELL_COMMAND_CHAR_LIMIT,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  machine as machineTable,
  shellCommand as shellCommandTable,
  step as stepTable,
} from '../src/db/schema.js';
import { seedLocalMachine } from '../src/services/machines.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

const AGENT_ID = 'agent-shell-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

interface World {
  s: TestServer;
  token: string;
  machineId: string;
  /** 起 build（withPlan=false → 单 build 步）不领，返回 buildId。 */
  startWorkerBuild(): Promise<string>;
  /** 领一个 pending worker 步。 */
  claimWorkerStep(): Promise<ClaimedStep>;
  precheck(
    stepId: string,
    command: string,
    cred?: string,
  ): Promise<{ res: Response; body: Record<string, unknown> }>;
  result(
    runId: string,
    body: unknown,
    cred?: string,
  ): Promise<{ res: Response; body: Record<string, unknown> }>;
  auditRows(): Array<typeof shellCommandTable.$inferSelect>;
}

async function setupWorld(opts: { shellEnabled?: boolean } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-shell-agent',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'shell-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  expect(enrollRes.status).toBe(200);
  const machineJson = (await enrollRes.json()) as { machineId: string; token: string };
  // 机器 shell 闸（默认 false——migration 回填律，M 组断言）；setup 直写 DB，
  // PATCH API 面由 P 组独立驱动。
  if (opts.shellEnabled) {
    s.db
      .update(machineTable)
      .set({ shellEnabled: true })
      .where(eq(machineTable.id, machineJson.machineId))
      .run();
  }
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'shell 探针任务', spec: '跑一行探针命令' },
  });
  void ((await todoRes.json()) as { id: string }).id;
  let todoSeq = 0;
  /** 每次领取各起新 todo（同 todo 二次 build 会 409——活跃 build 守卫）。 */
  async function startWorkerBuild(): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: `shell 探针任务 ${++todoSeq}`, spec: '跑一行探针命令' },
    });
    const freshTodo = ((await res.json()) as { id: string }).id;
    const buildRes = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [freshTodo],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    expect(buildRes.status).toBe(201);
    const body = (await buildRes.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
  }
  return {
    s,
    token: machineJson.token,
    machineId: machineJson.machineId,
    async startWorkerBuild() {
      return startWorkerBuild();
    },
    async claimWorkerStep() {
      await startWorkerBuild();
      const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineJson.token,
        body: {},
      });
      const body = (await claimRes.json()) as { step: ClaimedStep | null };
      return claimedStepSchema.parse(body.step);
    },
    async precheck(stepId, command, cred) {
      const res = await call(s.app, 'POST', `/api/machine/shell/${stepId}`, {
        cred: cred ?? machineJson.token,
        body: { command },
      });
      return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    async result(runId, body, cred) {
      const res = await call(s.app, 'POST', `/api/machine/shell/${runId}/result`, {
        cred: cred ?? machineJson.token,
        body,
      });
      return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    },
    auditRows() {
      return s.db.select().from(shellCommandTable).all();
    },
  };
}

/** 领步并预检一条命令（正/负路径共用）。 */
async function claimAndPrecheck(
  w: World,
  command = 'ls -la',
): Promise<{ step: ClaimedStep; res: Response; body: Record<string, unknown> }> {
  const step = await w.claimWorkerStep();
  const { res, body } = await w.precheck(step.step.id, command);
  return { step, res, body };
}

describe('claim 载荷：localTools 注册面（XMON-108 R1）', () => {
  async function claimWith(agentTools: string[], shellEnabled: boolean): Promise<ClaimedStep> {
    const w = await setupWorld({ shellEnabled });
    w.s.db.update(agentTable).set({ tools: agentTools }).where(eq(agentTable.id, AGENT_ID)).run();
    const step = await w.claimWorkerStep();
    w.s.dispose();
    return step;
  }

  test('双闸矩阵：remote_shell 仅 agent 开关 ∩ 机器开关 齐开才在（四组合）', async () => {
    // 齐 → 在。
    expect((await claimWith(['远程 shell'], true)).localTools).toContain(LOCAL_TOOL_REMOTE_SHELL);
    // agent 关 / 机器开 → 不在。
    expect((await claimWith([], true)).localTools).not.toContain(LOCAL_TOOL_REMOTE_SHELL);
    // agent 开 / 机器关 → 不在。
    expect((await claimWith(['远程 shell'], false)).localTools).not.toContain(
      LOCAL_TOOL_REMOTE_SHELL,
    );
    // 双关 → 不在。
    expect((await claimWith([], false)).localTools).not.toContain(LOCAL_TOOL_REMOTE_SHELL);
  });

  test('create_tag 只判 agent 工具，与机器旗无关（leader 裁定：机器层无对应闸）', async () => {
    expect((await claimWith(['创建标签'], false)).localTools).toContain(LOCAL_TOOL_CREATE_TAG);
    expect((await claimWith(['创建标签'], true)).localTools).toContain(LOCAL_TOOL_CREATE_TAG);
    // 两词同开 = 两词齐收（agent 开三档、机器开 → remote_shell + create_tag）。
    const both = await claimWith(['远程 shell', '创建标签', '推送分支'], true);
    expect(both.localTools).toEqual([LOCAL_TOOL_REMOTE_SHELL, LOCAL_TOOL_CREATE_TAG]);
  });

  test('全关 = 携带 []（least-privilege 与 skills/tools 同律；缺省保留给老 server）', async () => {
    expect((await claimWith([], true)).localTools).toEqual([]);
  });
});

describe('claim 载荷：chief 步不带 localTools（XMON-108 R1）', () => {
  test('chief 步 localTools 缺省（chief 无 worktree/无本地工具语义）', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    const key = await issueApiKey(s);
    s.db
      .insert(agentTable)
      .values({
        id: 'chief-agent-1',
        teamId: s.team.id,
        displayName: 'chief-agent',
        modelId: 'stub-model',
        provider: 'stub-gw',
      })
      .run();
    const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'chief-mbp', cliVersion: '0.1.0' },
    });

    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
    const { token } = (await enrollRes.json()) as { token: string };
    const patchRes = await call(s.app, 'PATCH', `/api/teams/${s.team.id}/chief`, {
      body: { agent: { agentId: 'chief-agent-1', thinkingLevel: null } },
    });
    expect(patchRes.status).toBe(200);
    const msgRes = await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      body: { content: '帮我看一下这个仓库的结构。' },
    });
    expect(msgRes.status).toBe(201);
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const body = (await claimRes.json()) as { step: ClaimedStep | null };
    expect(body.step).not.toBeNull();
    const step = claimedStepSchema.parse(body.step);
    expect(step.step.kind).toBe('chief');
    // chief 不携带（skills/tools 同律——缺省即 chief 面语义）。
    expect(step.localTools).toBeUndefined();
    // chief 步预检 = 409（无 shell 语义，非 403 授权拒绝）。
    const pre = await call(s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: token,
      body: { command: 'ls' },
    });
    expect(pre.status).toBe(409);
    s.dispose();
  });
});

describe('chief 写入点 → claim 反映（XMON-115）', () => {
  // 失败方式：executor 写 wire 词 remote_shell 而非开关词「远程 shell」→
  // claimLocalTools 判 AGENT_TOOL_SHELL 不命中、localTools 永不含 remote_shell；
  // 授予/撤销任一不生效同理。本测试走 daemon 的真实调用形态（POST
  // /api/machine/tool/<stepId>，chief 步）——不 mock executor。
  test('chief 会话 relay set_remote_shell 授予 → 下一次 worker claim localTools 含 remote_shell；撤销 → 不含', async () => {
    const w = await setupWorld({ shellEnabled: true }); // 机器闸常开，只动 agent 闸
    // chief 面：绑定 Agent + 开线程 + 领 chief 步（与上一 describe 同法）。
    w.s.db
      .insert(agentTable)
      .values({
        id: 'chief-agent-115',
        teamId: w.s.team.id,
        displayName: 'chief-agent-115',
        modelId: 'stub-model',
        provider: 'stub-gw',
        // #1260：chief 步只投绑定 Agent 的归属机——认领机即归属机。
        machineId: w.machineId,
      })
      .run();
    const patchRes = await call(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
      body: { agent: { agentId: 'chief-agent-115', thinkingLevel: null } },
    });
    expect(patchRes.status).toBe(200);
    const msgRes = await call(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      body: { content: '给 agent-shell-1 开远程 shell。' },
    });
    expect(msgRes.status).toBe(201);
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.token,
      body: {},
    });
    const chiefStep = claimedStepSchema.parse(((await claimRes.json()) as { step: unknown }).step);
    expect(chiefStep.step.kind).toBe('chief');
    // chief 会话触发写点 = daemon relay 的原样调用（{name, params} → {text}）。
    const grantRes = await call(w.s.app, 'POST', `/api/machine/tool/${chiefStep.step.id}`, {
      cred: w.token,
      body: { name: 'set_remote_shell', params: { agentId: AGENT_ID, enabled: true } },
    });
    expect(grantRes.status).toBe(200);
    expect(((await grantRes.json()) as { text: string }).text).toContain('"remoteShell":true');
    // 授予后的下一次 claim：localTools 反映（验收 #1；词 = 开关词命中判定）。
    const after = await w.claimWorkerStep();
    expect(after.localTools).toContain(LOCAL_TOOL_REMOTE_SHELL);
    // 撤销后的下一次 claim：不反映（fail-closed；机器闸仍开，只关 agent 闸）。
    const revokeRes = await call(w.s.app, 'POST', `/api/machine/tool/${chiefStep.step.id}`, {
      cred: w.token,
      body: { name: 'set_remote_shell', params: { agentId: AGENT_ID, enabled: false } },
    });
    expect(revokeRes.status).toBe(200);
    const afterRevoke = await w.claimWorkerStep();
    expect(afterRevoke.localTools).not.toContain(LOCAL_TOOL_REMOTE_SHELL);
    w.s.dispose();
  });
});

describe('PATCH /api/machines/{id}：shellEnabled 透传（XMON-108 R1）', () => {
  test('PATCH 走通 + 回显一致（验收 #5 回读）；单字段不撞 enabledRuntimes', async () => {
    const w = await setupWorld();
    // 先经 API 写 enabledRuntimes，验证后字段不被 shell PATCH 撞掉。
    const runtimeRes = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { enabledRuntimes: ['pi'] },
    });
    const on = machineRecordSchema.parse(await runtimeRes.json());
    expect(on.enabledRuntimes).toEqual(['pi']);
    expect(on.shellEnabled).toBe(false);
    // 单字段 PATCH：只动 shellEnabled。
    const res = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { shellEnabled: true },
    });
    const patched = machineRecordSchema.parse(await res.json());
    expect(patched.shellEnabled).toBe(true);
    expect(patched.enabledRuntimes).toEqual(['pi']); // 缺省 = 不变
    // GET 回读（me 通道同投影单源）。
    const me = machineRecordSchema.parse(
      await (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).json(),
    );
    expect(me.shellEnabled).toBe(true);
    // 关回去：下一 PATCH 同律。
    const off = machineRecordSchema.parse(
      await (
        await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
          body: { shellEnabled: false },
        })
      ).json(),
    );
    expect(off.shellEnabled).toBe(false);
    w.s.dispose();
  });

  test('空 body = no-op 200 回显当前值（不炸不写）', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const res = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, { body: {} });
    expect(res.status).toBe(200);
    const body = machineRecordSchema.parse(await res.json());
    expect(body.shellEnabled).toBe(true);
    w.s.dispose();
  });

  test('未知 id → 404 {error}；非 boolean → 400', async () => {
    const w = await setupWorld();
    const unknown = await call(w.s.app, 'PATCH', '/api/machines/nope', {
      body: { shellEnabled: true },
    });
    expect(unknown.status).toBe(404);
    expect(Object.keys((await unknown.json()) as Record<string, unknown>)).toEqual(['error']);
    const bad = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { shellEnabled: 'yes' },
    });
    expect(bad.status).toBe(400);
    w.s.dispose();
  });
});

describe('预检 POST /api/machine/shell/{stepId}（XMON-108 R1）', () => {
  test('双闸齐开 → 200 {allowed, runId} + running 审计行先于返回落库', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { res, body, step } = await claimAndPrecheck(w, 'git status');
    expect(res.status).toBe(200);
    const parsed = machineShellPrecheckResponseSchema.parse(body);
    expect(parsed.allowed).toBe(true);
    expect(parsed.runId).toBeTruthy();
    // 审计行：running、命令原文、机器/agent/step 归属、无终态字段。
    const rows = await w.auditRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(parsed.runId);
    expect(row.status).toBe('running');
    expect(row.command).toBe('git status');
    expect(row.stepId).toBe(step.step.id);
    expect(row.machineId).toBe(w.machineId);
    expect(row.agentId).toBe(AGENT_ID);
    expect(row.teamId).toBe(w.s.team.id);
    expect(row.exitCode).toBeNull();
    expect(row.finishedAt).toBeNull();
    w.s.dispose();
  });

  test('agent 无「远程 shell」→ 403 点名权限 tab + denied 审计行（含原因）', async () => {
    const w = await setupWorld({ shellEnabled: true }); // 机器开、agent 关
    const { res, body } = await claimAndPrecheck(w, 'rm -rf /');
    expect(res.status).toBe(403);
    expect(String(body.error)).toContain('未获「远程 shell」授权');
    expect(String(body.error)).toContain('Agent 详情页权限 tab');
    const rows = await w.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('denied');
    expect(rows[0]!.command).toBe('rm -rf /');
    expect(rows[0]!.errorMessage).toContain('未获「远程 shell」授权');
    expect(rows[0]!.finishedAt).not.toBeNull(); // 插入即终局
    w.s.dispose();
  });

  test('机器未开 shell → 403 点名机器 + denied 审计行', async () => {
    const w = await setupWorld(); // 机器关、agent 开
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { res, body } = await claimAndPrecheck(w, 'ls');
    expect(res.status).toBe(403);
    expect(String(body.error)).toContain('未开启 shell 访问');
    expect(String(body.error)).toContain('机器');
    const rows = await w.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('denied');
    w.s.dispose();
  });

  test('步中关机器闸 → 下一条命令立即 403（验收 #3：每调用重读，非 claim 期一次闸）', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const step = await w.claimWorkerStep();
    // 第一条：放行。
    const first = await w.precheck(step.step.id, 'echo one');
    expect(first.res.status).toBe(200);
    // 步中关闸（机器详情页动作——PATCH API 通道，非 DB 直写）。
    const off = await call(w.s.app, 'PATCH', `/api/machines/${w.machineId}`, {
      body: { shellEnabled: false },
    });
    expect(off.status).toBe(200);
    // 第二条：立即拒（不重新 claim）。
    const second = await w.precheck(step.step.id, 'echo two');
    expect(second.res.status).toBe(403);
    const rows = await w.auditRows();
    expect(rows.map((r) => r.status)).toEqual(['running', 'denied']);
    w.s.dispose();
  });

  test('步中摘 agent 工具 → 下一条命令立即 403（双闸每调用重读）', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const step = await w.claimWorkerStep();
    expect((await w.precheck(step.step.id, 'echo one')).res.status).toBe(200);
    w.s.db.update(agentTable).set({ tools: [] }).where(eq(agentTable.id, AGENT_ID)).run();
    const second = await w.precheck(step.step.id, 'echo two');
    expect(second.res.status).toBe(403);
    expect(String(second.body.error)).toContain('Agent 详情页权限 tab');
    w.s.dispose();
  });

  test('协议错：未领步/已收尾步/未知步的正确码；协议错不落审计行', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    // 未领步（pending，machineId null）→ ownedStep 404（他机同律：machineId
    // 不匹配即 404，与 heartbeat/done 面一致——存在性不泄权）。
    const buildId = await w.startWorkerBuild();
    const pendingStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()[0]!;
    expect(pendingStep.status).toBe('pending');
    const unclaimed = await w.precheck(pendingStep.id, 'ls');
    expect(unclaimed.res.status).toBe(404);
    // 已收尾（done）→ 409（不在飞）。
    const step = await w.claimWorkerStep();
    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: w.token,
      body: { status: 'success' },
    });
    expect(doneRes.status).toBe(200);
    const finished = await w.precheck(step.step.id, 'ls');
    expect(finished.res.status).toBe(409);
    // 未知步 → 404。
    const unknown = await w.precheck('step-nope', 'ls');
    expect(unknown.res.status).toBe(404);
    // 协议错不落审计行（审计只记授权决定）。
    expect(await w.auditRows()).toHaveLength(0);
    w.s.dispose();
  });

  test('他机预检本机已领步 → 404（ownedStep 同律）；坏 body → 400', async () => {
    const w = await setupWorld({ shellEnabled: true });
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const step = await w.claimWorkerStep();
    // 第二台机器（新 key + 异名）。
    const key2 = await issueApiKey(w.s);
    const enroll2 = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: key2,
      body: { teamId: w.s.team.id, name: 'shell-mbp-2', cliVersion: '0.1.0' },
    });

    const token2 = ((await enroll2.json()) as { token: string }).token;
    const foreign = await w.precheck(step.step.id, 'ls', token2);
    expect(foreign.res.status).toBe(404);
    // 坏 body：空命令 / 超长 → 400。
    const empty = await call(w.s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: w.token,
      body: { command: '' },
    });
    expect(empty.status).toBe(400);
    const long = await call(w.s.app, 'POST', `/api/machine/shell/${step.step.id}`, {
      cred: w.token,
      body: { command: 'x'.repeat(SHELL_COMMAND_CHAR_LIMIT + 1) },
    });
    expect(long.status).toBe(400);
    w.s.dispose();
  });
});

describe('回写 POST /api/machine/shell/{runId}/result（XMON-108 R1）', () => {
  async function allowOne(w: World): Promise<{ runId: string; step: ClaimedStep }> {
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { body, step } = await claimAndPrecheck(w);
    const parsed = machineShellPrecheckResponseSchema.parse(body);
    return { runId: parsed.runId, step };
  }

  test('done 回写：status/exitCode/output/finishedAt 落库', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const { res } = await w.result(runId, { status: 'done', exitCode: 0, output: 'total 0\n' });
    expect(res.status).toBe(200);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('done');
    expect(row.exitCode).toBe(0);
    expect(row.output).toBe('total 0\n');
    expect(row.finishedAt).not.toBeNull();
    w.s.dispose();
  });

  test('failed 回写：errorMessage 落库、exitCode 不落', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const { res } = await w.result(runId, {
      status: 'failed',
      errorMessage: 'command timed out after 60s',
    });
    expect(res.status).toBe(200);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toBe('command timed out after 60s');
    expect(row.exitCode).toBeNull();
    expect(row.finishedAt).not.toBeNull();
    w.s.dispose();
  });

  test('终态重复回写 = 幂等 200 不改写（网络重试不改账）', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    await w.result(runId, { status: 'done', exitCode: 0, output: 'first' });
    const again = await w.result(runId, { status: 'failed', errorMessage: 'retry noise' });
    expect(again.res.status).toBe(200);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('done'); // 先到的终态留账
    expect(row.output).toBe('first');
    expect(row.errorMessage).toBeNull();
    w.s.dispose();
  });

  test('denied 行回写 → 409（denied 的 runId 从未下发，协议错）', async () => {
    const w = await setupWorld(); // 机器关 → denied
    w.s.db
      .update(agentTable)
      .set({ tools: ['远程 shell'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const { res } = await claimAndPrecheck(w);
    expect(res.status).toBe(403);
    const deniedRow = (await w.auditRows())[0]!;
    const denied = await w.result(deniedRow.id, { status: 'done', exitCode: 0 });
    expect(denied.res.status).toBe(409);
    expect(deniedRow.status).toBe('denied'); // 原行不动
    w.s.dispose();
  });

  test('未知 runId → 404；他机回写 → 403（sync-result 同律）', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const unknown = await w.result('run-nope', { status: 'done' });
    expect(unknown.res.status).toBe(404);
    const key2 = await issueApiKey(w.s);
    const enroll2 = await call(w.s.app, 'POST', '/api/machine/enroll', {
      cred: key2,
      body: { teamId: w.s.team.id, name: 'shell-mbp-2', cliVersion: '0.1.0' },
    });
    const token2 = ((await enroll2.json()) as { token: string }).token;
    const foreign = await w.result(runId, { status: 'done' }, token2);
    expect(foreign.res.status).toBe(403);
    const row = (await w.auditRows())[0]!;
    expect(row.status).toBe('running'); // 他机回写不落账
    w.s.dispose();
  });

  test('词表外 status（running/pending）→ 400（schema 钉形状）', async () => {
    const w = await setupWorld({ shellEnabled: true });
    const { runId } = await allowOne(w);
    const bad = await w.result(runId, { status: 'running' });
    expect(bad.res.status).toBe(400);
    w.s.dispose();
  });
});

describe('migration：machine.shellEnabled 回填 false（XMON-108 R1）', () => {
  test('新建行（seed/enroll）与既有行读出 shellEnabled=false（存量默认关）', async () => {
    const w = await setupWorld(); // 不开闸
    // enroll 建的行。
    const me = machineRecordSchema.parse(
      await (await call(w.s.app, 'GET', '/api/machine/me', { cred: w.token })).json(),
    );
    expect(me.shellEnabled).toBe(false);
    // seed 建的本机行（index.ts 启动路径；列默认 false = 存量行回填同值）。
    seedLocalMachine(w.s.db, w.s.team.id);
    const seeded = w.s.db.select().from(machineTable).where(eq(machineTable.kind, 'local')).all();
    expect(seeded).toHaveLength(1);
    expect(seeded[0]!.shellEnabled).toBe(false);
    w.s.dispose();
  });
});
