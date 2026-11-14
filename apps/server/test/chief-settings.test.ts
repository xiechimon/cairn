import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  agentMemory,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  composeChiefSystemPrompt,
  getChiefEnvelope,
  patchChief,
  sendChiefMessage,
} from '../src/services/chief.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { issueApiKey, req, seedRoute } from './helpers.js';

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

  test('PATCH /chief refuses binding an Agent: the Coordinator model is the coordinator routing rule (D60)', async () => {
    await relay('save_memory', { scope: 'team', file: '旧记忆', content: '属于原 Agent' });
    const res = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, {
      agent: { agentId: AGENT2_ID, thinkingLevel: null },
    });
    expect(res.status).toBe(410);
    const mems = H.s.db.select().from(agentMemory).all();
    expect(mems.every((m) => m.agentId === AGENT_ID)).toBe(true);
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

  test('chief step claim payload always = the coordinator rule model (#1260 no inherited state)', async () => {
    const plain = await issueApiKey(H.s);
    const enroll = await H.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${plain}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        readyMachine({ teamId: H.teamId, name: 'chief-override-probe', cliVersion: '0.1.0' }),
      ),
    });
    expect(enroll.status).toBe(200);
    const { token } = (await enroll.json()) as { token: string };
    const probe = H.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.name, 'chief-override-probe'))
      .get()!;
    seedRoute(H.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: probe.id,
    });
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
    H.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.status, 'claimed')).run();
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

  test('memory tab = the team shared storage (GET teams/{id}/memories)', async () => {
    await relay('save_memory', {
      scope: 'team',
      file: '共用记忆',
      content: 'chief 与 thread 同源',
    });
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/memories`);
    expect(res.status).toBe(200);
    const mems = (await res.json()) as { title: string }[];
    expect(mems.some((m) => m.title === '共用记忆')).toBe(true);
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
    expect(prompt).toContain('### 项目');
    expect(prompt).toContain('自动合并（autonomous）');
    expect(prompt).not.toContain('合并（merge）动作只由人触发');
    expect(prompt).toContain('你不写任务正文');
    expect(prompt).toContain('摘要标题');
    expect(prompt).toContain('quotes 填这张卡覆盖的用户原句');
    expect(prompt).toContain('spec 不添加路由说明');
    expect(prompt).toContain('先后顺序用 dependsOn 表达');
  });

  test('systemPrompt is one language and grouped into sections in a fixed order', () => {
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
    const headings = [
      '## 章程',
      '## 工作约定',
      '### 路由',
      '### 决策边界',
      '### 项目归属',
      '### 回答',
      '### 事件回合',
      '### 记忆',
      '### 第三方文字',
      '### 技能',
      '## 团队',
      '### 项目',
      '### 进行中的任务',
      '### 技能',
      '## 记忆（团队共用）',
    ];
    let from = 0;
    for (const heading of headings) {
      const at = prompt.split('\n').indexOf(heading, from);
      expect(at, heading).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
    const englishSentences = prompt
      .split('\n')
      .filter((line) => /[A-Za-z]{3,}(?: [A-Za-z,;:.'"()-]+){4,}/.test(line));
    expect(englishSentences).toEqual([]);
    for (const jargon of ['核销', '围栏', 'wake 轮', '运行位', 'ADR 0026', '配额 100']) {
      expect(prompt, jargon).not.toContain(jargon);
    }
    expect(prompt.match(/save_memory/g)?.length).toBe(2);
  });

  test('systemPrompt lists each project with its description and carries the project-attribution rule (#1920)', () => {
    H.s.db
      .update(projectTable)
      .set({ description: '官网 cairn.xmon.me 的静态站点' })
      .where(eq(projectTable.id, H.projectId))
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
    expect(prompt).toMatch(/^- demo（id: [^）]+）：官网 cairn\.xmon\.me 的静态站点/m);
    expect(prompt).not.toContain('"description"');
    expect(prompt).toContain('项目归属');
    expect(prompt).toContain('先查再定');
    expect(prompt).toContain('只列仍然分不出的候选');
    expect(prompt).toContain('每个项目一张');
    expect(prompt).toContain('只回答，不建任务');
  });

  test('systemPrompt dispatch section: tasks go to a thread through open_thread, no agent or plan mode, static and independent of settings', () => {
    const deps = {
      db: H.s.db,
      hub: H.s.hub,
      machineHub: H.s.machineHub,
      user: H.s.user,
      skillsDir: H.s.skillsDir,
    };
    const prompt = composeChiefSystemPrompt(deps, H.teamId);
    expect(prompt).toContain('open_thread');
    expect(prompt).toContain('plan、写测试、实现、自检都由 thread 自己完成');
    expect(prompt).toContain('不写方案、不选模型');
    expect(prompt).toContain('message_thread');
    expect(prompt).toContain('自动合并（autonomous）');
    expect(prompt).not.toContain('withPlan:false');
    expect(prompt).not.toContain('dispatchReason');
    expect(prompt).not.toContain('派发模式（团队设置');

    patchChief(deps, H.teamId, { charter: '用户自己的章程' });
    const after = composeChiefSystemPrompt(deps, H.teamId);
    expect(after).toContain('用户自己的章程');
    expect(after).toContain('plan、写测试、实现、自检都由 thread 自己完成');
    expect(after).not.toContain('withPlan:false');
  });
});
