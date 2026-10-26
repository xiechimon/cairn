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

describe('chief settings 4 tabs + PATCH /chief (r5 section 2)', () => {
  test('GET /chief envelope four fields map one-to-one to the 4 tabs (agent/charter/watches/wakes)', async () => {
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief`);
    expect(res.status).toBe(200);
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.chief.agent).toEqual({ agentId: AGENT_ID });
    expect(env.agentActor?.id).toBe(AGENT_ID);
    expect(typeof env.chief.charter).toBe('string');
    expect(Array.isArray(env.watches)).toBe(true);
    expect(Array.isArray(env.wakes)).toBe(true);
    const wire = (await res.json()) as typeof env;
    expect(wire.chief.id).toBe(H.chiefId);
  });

  test('PATCH /chief binding a new Agent = rebind (memories do not migrate: no memory copy action)', async () => {
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
    const mems = H.s.db.select().from(agentMemory).all();
    expect(mems.every((m) => m.agentId === AGENT_ID)).toBe(true);
    expect(mems.some((m) => m.agentId === AGENT2_ID)).toBe(false);
  });

  test('PATCH /chief charter slot persisted (charter tab save surface [inferred])', async () => {
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

  test('PATCH /chief no longer accepts retired slots (#903 dispatchWithPlan; #1260 machineId/model/compactionModel)', async () => {
    type Env = { chief: Record<string, unknown> };
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
    expect('machineId' in got.chief).toBe(false);
    expect('model' in got.chief).toBe(false);
    expect('compactionModel' in got.chief).toBe(false);
  });

  test('chief step claim payload always = the bound Agent own model (#1260 no inherited state)', async () => {
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

    const send = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '模型来源探针。',
    });
    expect(send.status).toBe(201);
    expect(await claim()).toBe('stub-model');

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

  test('POST /chief/threads/:tid/rewind: truncates messages after the anchor + resets the session + re-enqueues the anchor content; activeRun 409; missing anchor 404 (#615 rework)', async () => {
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

    const busy = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads/${tid}/rewind`, {
      messageId: anchor!.id,
    });
    expect(busy.status).toBe(409);

    H.s.db.update(chiefThread).set({ activeRun: null }).where(eq(chiefThread.id, tid)).run();
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads/${tid}/rewind`, {
      messageId: anchor!.id,
    });
    expect(res.status).toBe(200);
    const msgs = H.s.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, tid)).all();
    expect(msgs.map((m) => m.content)).toEqual(['锚句。']);
    const thread = H.s.db.select().from(chiefThread).where(eq(chiefThread.id, tid)).get();
    expect(thread!.sessionId).toBe('');
    const steps = H.s.db.select().from(stepTable).where(eq(stepTable.buildId, tid)).all();
    expect(steps).toHaveLength(3);
    expect(steps[2]!.prompt).toBe('锚句。');
    expect(steps[2]!.status).toBe('pending');

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

  test('PATCH /chief compactionModel bare string/missing field -> 400 (#203)', async () => {
    const bare = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      compactionModel: 'm-fast',
    });
    expect(bare.status).toBe(400);
    const partial = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      compactionModel: { provider: 'stub-gw' },
    });
    expect(partial.status).toBe(400);
  });

  test('memory tab = shared storage with the bound Agent (GET agents/{aid}/memories)', async () => {
    await relay('save_memory', { title: '共用记忆', content: 'chief 与 agent 同源' });
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/agents/${AGENT_ID}/memories`);
    expect(res.status).toBe(200);
    const mems = (await res.json()) as { title: string; agentId: string }[];
    expect(mems.some((m) => m.title === '共用记忆' && m.agentId === AGENT_ID)).toBe(true);
  });

  test('systemPrompt composition includes charter + resource list + memories (02 section 4.3 input contract)', () => {
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
    expect(prompt).toContain('优先文档 Agent');
    expect(prompt).toContain('agents:');
    expect(prompt).toContain('autonomous');
    expect(prompt).toContain('ADR 0026');
    expect(prompt).not.toContain('合并（merge）动作只由人触发');
    expect(prompt).toContain('措辞→spec');
  });

  test('systemPrompt dispatch-decision section: judgment discipline + three signals + review gate always present + receipt can override, static and independent of settings (#903)', () => {
    const deps = {
      db: H.s.db,
      hub: H.s.hub,
      machineHub: H.s.machineHub,
      user: H.s.user,
      skillsDir: H.s.skillsDir,
    };
    const prompt = composeChiefSystemPrompt(deps, H.teamId);
    expect(prompt).toContain('当信息会实质改变结果、执行方式、权限或安全时才问');
    expect(prompt).toContain('否则自己决定，并说出你决定了什么');
    expect(prompt).toContain('有可复现步骤或失败测试的缺陷 → 直接修');
    expect(prompt).toContain('引入新能力、或改动跨包 → 先问');
    expect(prompt).toContain('判不准 → 先规划');
    expect(prompt).toContain('审阅关口恒在');
    expect(prompt).toContain('dispatchReason');
    expect(prompt).toContain('就地一句话推翻');
    expect(prompt).toContain('只影响这一次');
    expect(prompt).not.toContain('withPlan:false');
    expect(prompt).not.toContain('派发模式（团队设置');

    patchChief(deps, H.teamId, { charter: '用户自己的章程' });
    const after = composeChiefSystemPrompt(deps, H.teamId);
    expect(after).toContain('用户自己的章程');
    expect(after).toContain('当信息会实质改变结果、执行方式、权限或安全时才问');
    expect(after).not.toContain('withPlan:false');
  });
});
