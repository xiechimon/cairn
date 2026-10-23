// M4a Chief 编排行为对拍（04 §4 M4 组 = r5 §2–§5 六项 + 结构契约 02 §4.3）。
// 判定口径（04 §1 A4）：策略层（措辞→spec 的具体变换文本、分派权重决策）由 LLM
// 侧产，本层测「宿主机制」——relay 工具落库/溯源、watch-wake 三触发、驳回 v2
// diff、双 Agent 分槽、绑定/记忆不迁移。[推断]/[设计] 项不冒充实测。
// #1128：原 chief.test.ts 的共享 harness 收编位——8 个 scenario 文件
// （chief-thread / model-slot / settings / dispatch / watch / memory /
// reject-diff / tools）各自 registerChiefHarness()。状态从模块级 let 组收口
// 为 H 单出口，每用例 beforeEach 重绑（vitest 文件隔离 → 跨文件零共享）。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach } from 'vitest';
import {
  agent as agentTable,
  chief as chiefTable,
  chiefThread,
  machine as machineTable,
} from '../src/db/schema.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { bootServer, postProject, type TestServer } from './helpers.js';

export const AGENT_ID = 'agent-chief-1';
export const AGENT2_ID = 'agent-chief-2';

/** 各 scenario 文件共享的可变 harness 态（原模块级 let 组的收口，#1128）。 */
export interface ChiefHarnessState {
  s: TestServer;
  teamId: string;
  userId: string;
  chiefId: string;
  threadId: string;
  projectId: string;
}
export const H = {} as ChiefHarnessState;

export function toolDeps() {
  return {
    db: H.s.db,
    hub: H.s.hub,
    machineHub: H.s.machineHub,
    box: H.s.secretBox,
    user: H.s.user,
    reposDir: H.s.reposDir,
    attachmentsDir: H.s.attachmentsDir,
    skillsDir: H.s.skillsDir,
  };
}
export function ctx(over: Partial<ChiefToolCtx> = {}): ChiefToolCtx {
  return {
    teamId: H.teamId,
    userId: H.userId,
    chiefId: H.chiefId,
    threadId: H.threadId,
    chiefAgentId: AGENT_ID,
    conversationId: H.threadId,
    ...over,
  };
}
export async function relay(
  name: string,
  params: Record<string, unknown>,
  over?: Partial<ChiefToolCtx>,
) {
  const text = await executeChiefTool(toolDeps(), ctx(over), name, params);
  return JSON.parse(text) as unknown;
}

// #707 models 工具的 claude-code 行：执行机上报播种（machine 行直插
// claudeCodeReport——上报语义，不读测试机真实 ~/.claude）。
export function seedMachineReport(
  name: string,
  report: { installed: boolean; hostname: string; models: { id: string; name: string }[] },
): void {
  H.s.db
    .insert(machineTable)
    .values({ id: `machine-${name}`, teamId: H.teamId, name, claudeCodeReport: report })
    .run();
}

// #627 models 工具：claude-code 段 homeDir 注入位（mkdtemp 隔离目录，
// 可选写入 settings.json 钉住槽位内容）。
const claudeHomes: string[] = [];
export function claudeHome(settingsJson?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-chief-models-'));
  claudeHomes.push(dir);
  if (settingsJson !== undefined) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), settingsJson);
  }
  return dir;
}
afterAll(() => {
  for (const dir of claudeHomes.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function seedAgent(id: string, description: string, modelId = 'stub-model') {
  H.s.db
    .insert(agentTable)
    .values({
      id,
      teamId: H.teamId,
      displayName: id,
      description,
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId,
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
}

export function seedChiefThread(): void {
  const now = nowMs();
  H.s.db
    .insert(chiefTable)
    .values({
      id: H.chiefId,
      userId: H.userId,
      teamId: H.teamId,
      agentId: AGENT_ID,
      charter: '',
      watches: [],
      wakes: [],
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(chiefThread)
    .values({
      id: H.threadId,
      chiefId: H.chiefId,
      userId: H.userId,
      teamId: H.teamId,
      title: '帮 demo 写一份…',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
}

/** 每个 scenario 文件顶层调一次：beforeEach 重绑 H（建库/播种）。claudeHome
 *  的 mkdtemp 目录清理由本文件模块级 afterAll 承担（原 chief.test.ts 同位）。
 *  vitest 文件隔离保证每个文件拿到自己的 harness 模块实例，钩子注册不串文件。 */
export function registerChiefHarness(): void {
  beforeEach(async () => {
    H.s = bootServer();
    H.teamId = H.s.team.id;
    H.userId = H.s.user.id;
    H.chiefId = `chief-${H.userId}-${H.teamId}`;
    H.threadId = `chief-${newUuidv7()}`;
    H.projectId = await postProject(H.s.app, 'demo');
    seedAgent(AGENT_ID, '负责撰写与润色各类文档。');
    seedAgent(AGENT2_ID, '负责代码实现与工程修改。', 'stub-model-2');
    seedChiefThread();
  });
}
