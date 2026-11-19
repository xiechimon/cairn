import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chiefMessage,
  chiefThread,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  composeChiefSystemPrompt,
  getChiefEnvelope,
  sendChiefMessage,
} from '../src/services/chief.js';
import { AGENT_ID, AGENT2_ID, H, registerChiefHarness, relay } from './chief-harness.js';
import { issueApiKey, req, seedRoute } from './helpers.js';

registerChiefHarness();

describe('chief envelope; PATCH /chief is gone', () => {
  test('GET /chief envelope carries agent, watches and wakes, and no charter', async () => {
    const res = await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief`);
    expect(res.status).toBe(200);
    const env = getChiefEnvelope(
      { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user },
      H.teamId,
    );
    expect(env.chief.agent).toEqual({ agentId: AGENT_ID });
    expect(env.agentActor?.id).toBe(AGENT_ID);
    expect('charter' in env.chief).toBe(false);
    expect(Array.isArray(env.watches)).toBe(true);
    expect(Array.isArray(env.wakes)).toBe(true);
    const wire = (await res.json()) as typeof env;
    expect(wire.chief.id).toBe(H.chiefId);
  });

  test('PATCH /chief no longer exists: no charter, agent binding or retired slot is accepted', async () => {
    for (const body of [
      { charter: '章程' },
      { agent: { agentId: AGENT2_ID } },
      { model: { provider: 'stub-gw', modelId: 'm-x' } },
    ]) {
      const res = await req(H.s.app, 'PATCH', `/api/teams/${H.teamId}/chief`, body);
      expect(res.status).toBe(404);
    }
    const got = (await (await req(H.s.app, 'GET', `/api/teams/${H.teamId}/chief`)).json()) as {
      chief: Record<string, unknown>;
    };
    expect('charter' in got.chief).toBe(false);
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
    expect(override.status).toBe(404);
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

  test('systemPrompt composition includes the resource list + memories and no charter section (02 section 4.3 input contract)', () => {
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
    expect(prompt).not.toContain('## 章程');
    expect(prompt).toContain('### 项目');
    expect(prompt).toContain('代码任务成功后就完成，分支和 PR 保留');
    expect(prompt).toContain('只有用户在对话里明确要求合并时才用 merge_builds 合并当前交付');
    expect(prompt).toContain('不主动问要不要合并，不自己决定合并');
    expect(prompt).not.toContain('自动合并（autonomous）');
    expect(prompt).toContain('你不写任务正文');
    expect(prompt).toContain('摘要标题');
    expect(prompt).toContain('quotes 填这张卡覆盖的用户原句');
    expect(prompt).toContain('spec 不添加路由说明');
    expect(prompt).toContain('先后顺序用 dependsOn 表达');
    expect(prompt).toContain('唯一的例外是用户要你直接操作电脑');
    expect(prompt).toContain('同一回合最多重试 3 次');
    expect(prompt).toContain(
      'browser_act 的 fill_secret（ref、secret 名称和当前网站 origin）代填密码',
    );
    expect(prompt).toContain('首次使用会在对话中发出网站授权卡');
    expect(prompt).toContain('不必填写网站');
    expect(prompt).toContain('不要读取、索取或发送明文密码');
    expect(prompt).toContain('验证码、滑块、短信码、二次验证和设备确认仍用 request_takeover');
    expect(prompt).toContain(
      '不要再重试，也不要设法绕过拦截：直接用 request_takeover 请用户自己操作',
    );
    expect(prompt).toContain('都传 stealth: true，改用隐身浏览器');
    expect(prompt).toContain('执行前先用 ask_user 问用户');
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
      '## 工作约定',
      '### 路由',
      '### 决策边界',
      '### 项目归属',
      '### 回答',
      '### 电脑操作',
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
    expect(prompt.match(/save_memory/g)?.length).toBe(1);
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
    expect(prompt).toContain('不因任务完成、CI 通过或其他事件合并');
    expect(prompt).not.toContain('自动合并（autonomous）');
    expect(prompt).not.toContain('withPlan:false');
    expect(prompt).not.toContain('dispatchReason');
    expect(prompt).not.toContain('派发模式（团队设置');
  });
});
