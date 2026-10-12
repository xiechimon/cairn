// 总管设置 4 tab + PATCH /chief（#1128 自 chief.test.ts 拆分；判定口径与 M4a 组头注见
// ./chief-harness.ts）。共享 harness 收编位 = ./chief-harness.ts，
// 状态经 H 单出口每用例重绑。

import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  composeChiefSystemPrompt,
  getChiefEnvelope,
  patchChief,
  sendChiefMessage,
} from '../src/services/chief.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { issueApiKey, req } from './helpers.js';

registerChiefHarness();

// —— AC: 设置齿轮 4 tab 行为 + 绑定 PATCH /chief + 记忆不迁移（r5 §2/§3）——————

describe('总管设置 4 tab + PATCH /chief（r5 §2）', () => {
  test('GET /chief 封套四字段一一对应 4 tab（agent/charter/watches/wakes）', async () => {
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief`);
    expect(res.status).toBe(200);
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    // Agent tab → agent 绑定 + agentActor 全记录
    expect(env.chief.agent).toEqual({ agentId: AGENT_ID });
    expect(env.agentActor?.id).toBe(AGENT_ID);
    // 章程 tab → charter
    expect(typeof env.chief.charter).toBe('string');
    // 关注与提醒 tab → watches/wakes
    expect(Array.isArray(env.watches)).toBe(true);
    expect(Array.isArray(env.wakes)).toBe(true);
    const wire = (await res.json()) as typeof env;
    expect(wire.chief.id).toBe(H.chiefId);
  });

  test('PATCH /chief 绑定新 Agent = 换绑（记忆不迁移：无记忆复制动作）', async () => {
    // 记忆存在原绑定 Agent 存储（r5 §6 共用）；换绑后不迁移。
    await relay('save_memory', { title: '旧记忆', content: '属于原 Agent' });
    const res = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      agent: { agentId: AGENT2_ID, thinkingLevel: null },
    });
    expect(res.status).toBe(200);
    const env = (await res.json()) as {
      chief: { agent: { agentId: string } | null };
      agentActor: { id: string } | null;
    };
    expect(env.chief.agent).toEqual({ agentId: AGENT2_ID });
    expect(env.agentActor?.id).toBe(AGENT2_ID);
    // 记忆不迁移：旧记忆仍在原 Agent（AGENT_ID）名下，未复制到 AGENT2_ID。
    const mems = H.s.db.select().from(agentMemory).all();
    expect(mems.every((m) => m.agentId === AGENT_ID)).toBe(true);
    expect(mems.some((m) => m.agentId === AGENT2_ID)).toBe(false);
  });

  test('PATCH /chief charter 槽落库（章程 tab 保存面 [推断]）', async () => {
    const res = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      charter: '模型路由：文档任务用 scribe。',
    });
    expect(res.status).toBe(200);
    const env = (await res.json()) as { chief: { charter: string } };
    expect(env.chief.charter).toContain('模型路由');
    const patched = patchChief(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
      { charter: '' },
    );
    expect(patched.chief.charter).toBe('');
  });

  // 退役槽族（#903 dispatchWithPlan——ADR 0014 判定权归 chief；#1260
  // machineId/model/compactionModel——总管降级，模型与去处读绑定 Agent
  // 自身配置）。失败方式——① PATCH 单独发退役槽仍被受理（僵尸槽没拆干净）；
  // ② GET 封套仍投影该键（契约面残留，web 会重建哑控件）；③ 与合法槽混发
  // 时该键被落库。
  test('PATCH /chief 不再受理退役槽（#903 dispatchWithPlan；#1260 machineId/model/compactionModel）', async () => {
    type Env = { chief: Record<string, unknown> };
    // 单独发 = 两槽皆无 → refine 400（退役键被剥离后视同空 body）。
    const lone = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      dispatchWithPlan: false,
    });
    expect(lone.status).toBe(400);
    for (const retired of [
      { machineId: 'm-x' },
      { model: { provider: 'stub-gw', modelId: 'm-x' } },
      { compactionModel: { provider: 'stub-gw', modelId: 'm-x' } },
    ]) {
      const res = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, retired);
      expect(res.status).toBe(400);
    }
    // 与合法槽混发 → 200，但该键被 schema 剥离：封套不回显、不落库。
    const withCharter = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      charter: '章程照常',
      dispatchWithPlan: false,
    });
    expect(withCharter.status).toBe(200);
    const patched = (await withCharter.json()) as Env;
    expect(patched.chief.charter).toBe('章程照常');
    expect('dispatchWithPlan' in patched.chief).toBe(false);
    const got = (await (await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief`)).json()) as Env;
    expect('dispatchWithPlan' in got.chief).toBe(false);
    // #1260：封套投影面无三键（records 面同钉，见 shared records 测试）。
    expect('machineId' in got.chief).toBe(false);
    expect('model' in got.chief).toBe(false);
    expect('compactionModel' in got.chief).toBe(false);
  });

  test('chief 步 claim 载荷恒 = 绑定 Agent 自身模型（#1260 无继承态）', async () => {
    // 机器面（machine-wire 同配方）：发行 key → Bearer key enroll 拿 machine
    // token → Bearer token claim。#1260：chief 步只投绑定 Agent 的归属机——
    // 把 AGENT_ID 的归属机指到刚注册的探针机（DB 直写，claim 闸读
    // agent.machineId）。
    const plain = await issueApiKey(H.s);
    const enroll = await H.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${plain}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: H.teamId, name: 'chief-override-probe', cliVersion: '0.1.0' }),
    });
    expect(enroll.status).toBe(200);
    const { token } = (await enroll.json()) as { token: string };
    const probe = H.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.name, 'chief-override-probe'))
      .get()!;
    H.s.db.update(agentTable).set({ machineId: probe.id }).where(eq(agentTable.id, AGENT_ID)).run();
    const claim = async () => {
      const res = await H.s.app.request('/api/machine/tasks/claim', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { step: { agent: { modelId: string } } | null };
      if (body.step === null) throw new Error('claim 空手：chief 步未入队或被抢');
      return body.step.agent.modelId;
    };

    // 载荷 = 绑定 Agent 的 modelId（harness seed stub-model）。
    const send = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '模型来源探针。',
    });
    expect(send.status).toBe(201);
    expect(await claim()).toBe('stub-model');

    // 覆盖入口已不存在：PATCH model → 400；下一回合载荷不变。
    const override = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      model: { provider: 'stub-gw', modelId: 'm-override' },
    });
    expect(override.status).toBe(400);
    const send2 = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '覆盖已退役回合。',
    });
    expect(send2.status).toBe(201);
    expect(await claim()).toBe('stub-model');
  });

  test('POST /chief/threads/:tid/rewind：截断锚后消息 + 重置会话 + 锚内容重入队；activeRun 409；锚缺 404（#615 返工）', async () => {
    // 两轮：锚 A（POST 建线程）+ 后续 B（同线程续消息）。
    const created = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '锚句。',
    });
    expect(created.status).toBe(201);
    const tid = ((await created.json()) as { thread: { id: string } }).thread.id;
    sendChiefMessage(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
      {
        threadId: tid,
        content: '后续句。',
      },
    );
    const anchor = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, tid))
      .all()
      .find((m) => m.content === '锚句。');
    expect(anchor).toBeDefined();

    // 活跃回合守门：入队后 activeRun 在位 → 409（steer 面同律，回合中不 rewind）。
    const busy = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads/${tid}/rewind`, {
      messageId: anchor!.id,
    });
    expect(busy.status).toBe(409);

    // 回合收尾态（activeRun 清）后 rewind 成立。
    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, tid)).run();
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads/${tid}/rewind`, {
      messageId: anchor!.id,
    });
    expect(res.status).toBe(200);
    // 截断：锚后消息（后续句）移除，锚保留。
    const msgs = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, tid)).all();
    expect(msgs.map((m) => m.content)).toEqual(['锚句。']);
    // 会话重置：pi 会话不可倒带 → sessionId 清空，下轮 new session。
    const thread = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, tid)).get();
    expect(thread!.sessionId).toBe('');
    // 重入队：A 步 + B 步 + rewind 步 = 3，末步 prompt = 锚内容。
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, tid)).all();
    expect(steps).toHaveLength(3);
    expect(steps[2]!.prompt).toBe('锚句。');
    expect(steps[2]!.status).toBe('pending');

    // 锚缺 / 他线程消息 → 404。
    const missing = await req(
      H.s.app,
      'POST',
      `/api/teams/${H.teamId}/chief/threads/${tid}/rewind`,
      {
        messageId: 'msg-nope',
      },
    );
    expect(missing.status).toBe(404);
  });

  test('PATCH /chief compactionModel 裸字符串/缺字段 → 400（#203）', async () => {
    const bare = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      compactionModel: 'm-fast',
    });
    expect(bare.status).toBe(400);
    const partial = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      compactionModel: { provider: 'stub-gw' },
    });
    expect(partial.status).toBe(400);
  });

  test('记忆 tab = 与绑定 Agent 共用存储（GET agents/{aid}/memories）', async () => {
    await relay('save_memory', { title: '共用记忆', content: 'chief 与 agent 同源' });
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/agents/${AGENT_ID}/memories`);
    expect(res.status).toBe(200);
    const mems = (await res.json()) as { title: string; agentId: string }[];
    expect(mems.some((m) => m.title === '共用记忆' && m.agentId === AGENT_ID)).toBe(true);
  });

  test('systemPrompt 合成含 charter + 资源清单 + 记忆（02 §4.3 输入契约）', () => {
    H.s.db
      .update(chiefTable)
      .set({ charter: '优先文档 Agent' })
      .where(eq(chiefTable.id, H.chiefId))
      .run();
    const prompt = composeChiefSystemPrompt(
      {
        db: H.s.db,
        hub: H.s.hub,
        machineHub: H.s.machineHub,
        user: H.s.user,
        skillsDir: H.s.skillsDir,
      },
      H.teamId,
    );
    expect(prompt).toContain('优先文档 Agent'); // charter
    expect(prompt).toContain('agents:'); // 团队资源清单
    expect(prompt).toContain('措辞→spec'); // 策略指引
  });

  // #903（ADR 0014）：派发判定节 = 静态章程 prose（D5：判据不进代码
  // 规则表、不按设置合成）。失败方式——① 提示词写死直执行指令（#892 的
  // 8/8 病灶回归）；② 判定节仍按设置合成（设置槽已删，合成无据 = 哑分支）；
  // ③ 判断纪律 / 三条可判信号 / 审阅闸恒在 / 回执可推翻，任一要素缺位。
  test('systemPrompt 派发判定节：判断纪律 + 三条信号 + 审阅闸恒在 + 回执可推翻，静态不依赖设置（#903）', () => {
    const deps = {
      db: H.s.db,
      hub: H.s.hub,
      machineHub: H.s.machineHub,
      user: H.s.user,
      skillsDir: H.s.skillsDir,
    };
    const prompt = composeChiefSystemPrompt(deps, H.teamId);
    // 判断纪律（multica 内置 Chief of Staff 指令原句，D5 出厂唯一纪律）。
    expect(prompt).toContain('当信息会实质改变结果、执行方式、权限或安全时才问');
    expect(prompt).toContain('否则自己决定，并说出你决定了什么');
    // 三条可判信号（prose 非硬规则）。
    expect(prompt).toContain('有可复现步骤或失败测试的缺陷 → 直接修');
    expect(prompt).toContain('引入新能力、或改动跨包 → 先问');
    expect(prompt).toContain('判不准 → 先规划');
    // D3：直接修只跳过方案确认，审阅闸永远在。
    expect(prompt).toContain('审阅关口恒在');
    // D4：判定 + 说 + 可推翻（理由落 transcript 可审计；推翻只影响这一次）。
    expect(prompt).toContain('dispatchReason');
    expect(prompt).toContain('就地一句话推翻');
    expect(prompt).toContain('只影响这一次');
    // 病灶负向钉：不再写死直执行指令、不再按设置合成。
    expect(prompt).not.toContain('withPlan:false');
    expect(prompt).not.toContain('派发模式（团队设置');

    // 静态面：翻用户章程不改判定节（判定纪律是出厂件，不是设置投影）。
    patchChief(deps, H.teamId, { charter: '用户自己的章程' });
    const after = composeChiefSystemPrompt(deps, H.teamId);
    expect(after).toContain('用户自己的章程');
    expect(after).toContain('当信息会实质改变结果、执行方式、权限或安全时才问');
    expect(after).not.toContain('withPlan:false');
  });
});
