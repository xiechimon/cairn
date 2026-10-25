import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendPlanLocationNote,
  buildRestartPrompt,
  buildTaskPromptText,
  composeTaskPromptWithInstruction,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  message as messageTable,
  step as stepTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const PLAN_MD = [
  '# 方案',
  '',
  'Context: 重启探针任务，第一轮会失败。',
  'Changes: 在 README.md 追加一行 m7 restart probe。',
  'Edge cases: 无。',
  'Verification: 读回 README.md 确认探针行在位。',
].join('\n');

function userWireText(m: { role: string; content?: unknown }): string | null {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    const parts = m.content.filter(
      (p): p is { type: 'text'; text: string } =>
        typeof p === 'object' && p !== null && (p as { type?: string }).type === 'text',
    );
    return parts.length > 0 ? parts.map((p) => p.text).join('') : null;
  }
  return null;
}

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    { status: 400 },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` },
      },
    },
    { content: '已按反馈调整，重启轮方案就绪。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-m7-restart-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'm7-restart-mbp',
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('M7 failed-phase send E2E: failed send → restart → feedback joins the new round session → runs to confirm', () => {
  test('full-chain persistence + new round actually runs + phase gate rejects', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: 'restart 探针',
      spec: '这个任务的第一轮会失败。',
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const failedBuildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'failed', 150_000);

    const sent = await api(server.url, 'POST', `/api/builds/${failedBuildId}/steps`, {
      action: 'restart',
      feedback: '把测试也补上',
      clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(202);
    expect(sent.body).toEqual({ delegated: true });

    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    const newBuildId = todoRow.latestBuildId!;
    expect(newBuildId).not.toBe(failedBuildId);
    const newBuild = server.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, newBuildId))
      .get()!;
    expect(newBuild.prevPhase).toBe('failed');
    expect(newBuild.withPlan).toBe(true);
    expect(newBuild.triggerSource).toBe('user');
    expect(todoRow.assignment).toEqual({
      plan: { agentId: AGENT_ID },
      build: { agentId: AGENT_ID },
    });

    const face = await api(server.url, 'GET', `/api/conversations/${newBuildId}/messages`);
    const faceBody = face.body as { messages: { role: string; content: unknown }[] };
    expect(faceBody.messages.some((m) => m.role === 'user' && m.content === '把测试也补上')).toBe(
      true,
    );

    const msgRow = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, newBuildId))
      .all()
      .find((m) => m.role === 'user')!;
    const firstStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, newBuildId))
      .orderBy(asc(stepTable.createdAt))
      .all()[0]!;
    expect(msgRow.createdAt).toBeLessThanOrEqual(firstStep.createdAt);
    expect(firstStep.kind).toBe('plan');
    expect(firstStep.prompt).toContain('把测试也补上');

    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    const expectedPrompt = appendPlanLocationNote(
      composeTaskPromptWithInstruction(
        buildTaskPromptText('restart 探针', '这个任务的第一轮会失败。'),
        buildRestartPrompt('把测试也补上'),
      ),
      join(paths.plansDir, newBuildId, PLAN_FILE_NAME),
    );
    const llmSawFeedback = stub.requests.some((r) =>
      r.messages.some((m) => m.role === 'user' && userWireText(m) === expectedPrompt),
    );
    expect(llmSawFeedback).toBe(true);
    const faceAfter = await api(server.url, 'GET', `/api/conversations/${newBuildId}/messages`);
    const rowsAfter = (faceAfter.body as { messages: { role: string; content: unknown }[] })
      .messages;
    expect(rowsAfter.some((m) => m.role === 'user' && m.content === expectedPrompt)).toBe(true);

    const againNew = await api(server.url, 'POST', `/api/builds/${newBuildId}/steps`, {
      action: 'restart',
      feedback: '再来一轮',
      clientMessageId: randomUUID(),
    });
    expect(againNew.status).toBe(409);
    const againOld = await api(server.url, 'POST', `/api/builds/${failedBuildId}/steps`, {
      action: 'restart',
      feedback: '再来一轮',
      clientMessageId: randomUUID(),
    });
    expect(againOld.status).toBe(409);
    const builds = server.db
      .select({ id: buildTable.id })
      .from(buildTable)
      .where(eq(buildTable.todoId, world.todoId))
      .all();
    expect(builds).toHaveLength(2);
  }, 240_000);
});
