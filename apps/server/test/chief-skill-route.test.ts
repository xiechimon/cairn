// #823 发送后 skill 路由的 claim 面契约：claim 时（worker 开工前路由位）
// 服务端按用户消息检测技能，提示节落 **instruction（每轮用户消息）** ——
// - 用户触发轮才检测（wake/系统轮无节）；
// - systemPrompt 保持逐字节稳定：节是按本条消息关键词生成的 per-run 值，
//   写进它会让每轮字节都变、前缀缓存整体失效（Multica MUL-5377 同坑，
//   docs/spec/24）。最后一条用例专钉这个不变量；
// - step.prompt 在库里仍是用户原文逐字（本文件钉 claim 面的 instruction =
//   原文 + 显式标注的建议块）；
// - 普通对话零节（第一失败方式：不劫持）；
// - skills 资源清单带 description（agent 自检切合度用）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimedStepSchema } from '@pacman/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import { agent as agentTable, chief as chiefTable, chiefThread } from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { enqueueChiefStep } from '../src/services/chief.js';
import {
  bindAgentHome,
  bootServer,
  issueApiKey,
  machineIdByName,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_ID = 'agent-route-1';

let s: TestServer;
let teamId: string;
let userId: string;
let chiefId: string;

function seedSkill(dirName: string, name: string, description: string): void {
  mkdirSync(join(s.skillsDir, dirName), { recursive: true });
  writeFileSync(
    join(s.skillsDir, dirName, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n步骤…\n`,
  );
}

function seedAgentAndChief(): void {
  const now = nowMs();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: AGENT_ID,
      description: '负责调度',
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId,
      teamId,
      agentId: AGENT_ID,
      charter: '',
      watches: [],
      wakes: [],
      createdAt: now,
    })
    .run();
}

async function claimToken(): Promise<string> {
  const plain = await issueApiKey(s);
  const enroll = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${plain}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId, name: 'route-probe', cliVersion: '0.1.0' }),
  });
  expect(enroll.status).toBe(200);
  // #1260：chief 步只投绑定 Agent 的归属机——认领机即归属机。
  bindAgentHome(s, AGENT_ID, machineIdByName(s, 'route-probe'));
  return ((await enroll.json()) as { token: string }).token;
}

async function claim(token: string) {
  const res = await s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: unknown };
  if (body.step === null) throw new Error('claim 空手：chief 步未入队或被抢');
  return claimedStepSchema.parse(body.step);
}

beforeEach(() => {
  s = bootServer();
  teamId = s.team.id;
  userId = s.user.id;
  chiefId = `chief-${userId}-${teamId}`;
  seedAgentAndChief();
  seedSkill('morning-reminder', 'morning-reminder', '定时提醒与日程通知');
});

describe('claim 面 skill 路由（#823）', () => {
  test('提醒消息 → instruction 尾带路由节（点名技能 + 内置回落），systemPrompt 不带', async () => {
    const content = '明早 9 点提醒我开站会';
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { content });
    expect(sent.status).toBe(201);
    const claimed = await claim(await claimToken());
    expect(claimed.step.kind).toBe('chief');
    // 节落 instruction，systemPrompt 保持干净（缓存前缀不变量）。
    expect(claimed.chief?.systemPrompt ?? '').not.toContain('发送后自动检测');
    const instruction = (claimed as { instruction?: string }).instruction ?? '';
    expect(instruction).toContain('发送后自动检测');
    expect(instruction).toContain('morning-reminder');
    expect(instruction).toContain('定时提醒与日程通知');
    expect(instruction).toContain('set_wake');
    // 用户原文仍在节之前逐字可辨（节是其后的显式标注建议块）。
    expect(instruction.startsWith(content)).toBe(true);
  });

  test('普通对话 → 无路由节（第一失败方式：不劫持）', async () => {
    const content = '明天的会议纪要帮我整理一下';
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { content });
    expect(sent.status).toBe(201);
    const claimed = await claim(await claimToken());
    // 无命中 = instruction 就是用户原文逐字（节缺席，不追加任何东西）。
    expect((claimed as { instruction?: string }).instruction).toBe(content);
  });

  test('缓存前缀不变量：路由命中与否，systemPrompt 逐字节相同', async () => {
    // 命中的那条（提醒意图，会生成路由节）与不命中的那条走两条独立线程，
    // 团队资源完全相同 ⇒ systemPrompt 必须逐字节相同。
    // 修复前：命中轮的节被追加进 systemPrompt，两条线程的字节不同，
    // 下一轮 continue session 的前缀缓存整体失效（MUL-5377 同坑）。
    const hit = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
      content: '明早 9 点提醒我开站会',
    });
    expect(hit.status).toBe(201);
    const miss = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
      content: '今天天气不错',
    });
    expect(miss.status).toBe(201);

    const token = await claimToken();
    const first = await claim(token);
    const second = await claim(token);
    expect(first.chief?.systemPrompt).toBe(second.chief?.systemPrompt);
    // 两条的 instruction 必须**不同**——否则这条用例没在测该测的东西
    // （节压根没生成，或两条消息命中了同一形态）。
    expect((first as { instruction?: string }).instruction).not.toBe(
      (second as { instruction?: string }).instruction,
    );
  });

  test('wake 轮 → 无路由节（系统触发不检测）', async () => {
    const now = nowMs();
    const threadId = `chief-${userId}-${teamId}-wake`;
    s.db
      .insert(chiefThread)
      .values({
        id: threadId,
        chiefId,
        userId,
        teamId,
        title: 'wake 探针线程',
        createdAt: now,
        updatedAt: now,
        sessionRuntime: 'pi',
        sessionId: '',
        sessionOpenedAt: now,
        toolDefHashes: {},
        toolResultHashes: {},
      })
      .run();
    enqueueChiefStep({ db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user }, threadId, {
      prompt: '任务 #1 已合并完成（done）。请向用户汇报。',
      trigger: 'settle',
    });
    const claimed = await claim(await claimToken());
    expect(claimed.chief?.systemPrompt).not.toContain('发送后自动检测');
    expect((claimed as { instruction?: string }).instruction ?? '').not.toContain('发送后自动检测');
    expect(claimed.chief?.trigger).toBe('settle');
  });

  test('skills 资源清单带 description + 路由约定行（agent 自检可用）', async () => {
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
      content: '随便聊聊今天的安排',
    });
    expect(sent.status).toBe(201);
    const claimed = await claim(await claimToken());
    const prompt = claimed.chief?.systemPrompt ?? '';
    expect(prompt).toContain('morning-reminder');
    expect(prompt).toContain('定时提醒与日程通知');
    expect(prompt).toContain('技能路由提示节在位时');
  });
});
