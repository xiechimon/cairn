import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { afterAll, beforeEach } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
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

export function seedMachineReport(
  name: string,
  report: { installed: boolean; hostname: string; models: { id: string; name: string }[] },
): void {
  H.s.db
    .insert(machineTable)
    .values({ id: `machine-${name}`, teamId: H.teamId, name, claudeCodeReport: report })
    .run();
}

const claudeHomes: string[] = [];
export function claudeHome(settingsJson?: string): string {
  const dir = makeTestTempDir('cairn-chief-models-');
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
