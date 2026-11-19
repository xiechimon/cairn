import { CHIEF_REMOTE_TOOLS, CHIEF_ROUTER_TOOLS, COMPUTER_REMOTE_TOOLS } from '@cairn/shared';
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
  coordinatorTurnState,
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

  const promptDeps = () => ({
    db: H.s.db,
    hub: H.s.hub,
    machineHub: H.s.machineHub,
    user: H.s.user,
    skillsDir: H.s.skillsDir,
  });

  test('systemPrompt is one English text in a fixed tag order with the preferences snapshot last', () => {
    const prompt = composeChiefSystemPrompt(promptDeps(), H.teamId);
    expect(prompt.startsWith('You are the Coordinator')).toBe(true);
    const tags = [
      '<how_you_work>',
      '<asking>',
      '<talking>',
      '<events>',
      '<untrusted>',
      '<tools>',
      '<turn_notes>',
      '<preferences>',
    ];
    const at = tags.map((tag) => prompt.indexOf(tag));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(prompt).toContain("Reply in the user's language");
    expect(prompt).not.toMatch(/[\u4e00-\u9fff]/);
    expect(prompt).not.toContain('## 章程');
  });

  test('systemPrompt carries no live data: projects, tasks and the model go in the turn notes', () => {
    H.s.db
      .update(projectTable)
      .set({ description: 'static site for the homepage' })
      .where(eq(projectTable.id, H.projectId))
      .run();
    const prompt = composeChiefSystemPrompt(promptDeps(), H.teamId);
    expect(prompt).not.toContain(H.projectId);
    expect(prompt).not.toContain('static site for the homepage');
    expect(prompt).not.toContain('Your model');
    const state = coordinatorTurnState(promptDeps(), H.teamId);
    expect(state).toMatch(/^- demo \(id: [^)]+\): static site for the homepage/m);
    expect(state).toContain('Your model:');
    expect(state).toContain('Running tasks: none');
  });

  test('the old prompt rules live in the descriptions of the tools they govern', () => {
    const definition = (name: string) =>
      [...CHIEF_REMOTE_TOOLS, ...CHIEF_ROUTER_TOOLS, ...COMPUTER_REMOTE_TOOLS].find(
        (t) => t.name === name,
      )!;
    const tool = (name: string) => definition(name).description;
    expect(tool('create_todo')).toContain('You write no task text');
    expect(tool('create_todo')).toContain('search todos with query');
    expect(JSON.stringify(definition('create_todo').parameters)).toContain(
      "the owner's frequently used models",
    );
    expect(tool('create_todo')).toContain(
      'One message about several projects becomes one todo per project',
    );
    expect(tool('merge_builds')).toContain('only when the user explicitly instructed you to merge');
    expect(tool('archive_todos')).toContain('This is the only way to end a todo');
    expect(tool('delete_todos')).toContain(
      'only when the owner explicitly asks for permanent deletion',
    );
    expect(tool('notify_user')).toContain('[wake:settle]');
    expect(tool('message_thread')).toContain('in their own words');
    expect(tool('browser_act')).toContain('at most 3 retries in a turn');
    expect(tool('browser_act')).toContain('fill_secret');
    expect(tool('browser_navigate')).toContain('stealth: true');
    expect(tool('update_memory')).toContain('一个月后这条还对');
    const prompt = composeChiefSystemPrompt(promptDeps(), H.teamId);
    for (const moved of [
      'fill_secret',
      'merge_builds',
      'archive_todos',
      'stealth',
      'supersededBy',
    ]) {
      expect(prompt, moved).not.toContain(moved);
    }
  });

  test('systemPrompt is byte-identical when projects, tasks and the model change', () => {
    const before = composeChiefSystemPrompt(promptDeps(), H.teamId);
    H.s.db
      .update(projectTable)
      .set({ name: 'renamed', description: 'changed' })
      .where(eq(projectTable.id, H.projectId))
      .run();
    expect(composeChiefSystemPrompt(promptDeps(), H.teamId)).toBe(before);
  });
});
