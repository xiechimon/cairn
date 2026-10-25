import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claimedStepSchema } from '@cairn/shared';
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

describe('claim-surface skill routing (#823)', () => {
  test('reminder message -> instruction tails a routing section (names the skill + built-in fallback), systemPrompt does not carry it', async () => {
    const content = '明早 9 点提醒我开站会';
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { content });
    expect(sent.status).toBe(201);
    const claimed = await claim(await claimToken());
    expect(claimed.step.kind).toBe('chief');
    expect(claimed.chief?.systemPrompt ?? '').not.toContain('发送后自动检测');
    const instruction = (claimed as { instruction?: string }).instruction ?? '';
    expect(instruction).toContain('发送后自动检测');
    expect(instruction).toContain('morning-reminder');
    expect(instruction).toContain('定时提醒与日程通知');
    expect(instruction).toContain('set_wake');
    expect(instruction.startsWith(content)).toBe(true);
  });

  test('ordinary conversation -> no routing section (first failure mode: not hijacked)', async () => {
    const content = '明天的会议纪要帮我整理一下';
    const sent = await req(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, { content });
    expect(sent.status).toBe(201);
    const claimed = await claim(await claimToken());
    expect((claimed as { instruction?: string }).instruction).toBe(content);
  });

  test('cache prefix invariant: systemPrompt is byte-identical whether or not routing hits', async () => {
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
    expect((first as { instruction?: string }).instruction).not.toBe(
      (second as { instruction?: string }).instruction,
    );
  });

  test('wake turn -> no routing section (system trigger is not checked)', async () => {
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

  test('skills resource list carries description + routing convention line (agent self-check usable)', async () => {
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
