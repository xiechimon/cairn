import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTaskPromptText } from '@cairn/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  message as messageTable,
  step as stepTable,
  todo as todoTable,
} from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, seedWorld, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const TASK_TITLE = '空白反馈探针';
const TASK_SPEC = '重启轮不注入空指令。';
const TASK_TEXT = buildTaskPromptText(TASK_TITLE, TASK_SPEC);

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
let home: string;

beforeAll(async () => {
  stub = await startStubLlm([{ status: 400 }, { content: '重启轮照常执行。' }]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-restart-blank-home-'));
  const paths: StatePaths = statePaths(home, join(home, 'workspaces'));
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'restart-blank-mbp',
    },
    {},
  );
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('blank-feedback restart round (#720 negative case): no empty instruction injected', () => {
  test('blank feedback → plain restart round: no instruction, no blank user row, session prompt = task text', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: TASK_TITLE,
      spec: TASK_SPEC,
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    const failedBuildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world.todoId) === 'failed', 150_000);

    const sent = await api(server.url, 'POST', `/api/builds/${failedBuildId}/steps`, {
      action: 'restart',
      feedback: '   ',
      clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(202);

    const todoRow = server.db.select().from(todoTable).where(eq(todoTable.id, world.todoId)).get()!;
    const newBuildId = todoRow.latestBuildId!;
    expect(newBuildId).not.toBe(failedBuildId);

    const firstStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, newBuildId))
      .orderBy(asc(stepTable.createdAt))
      .all()[0]!;
    expect(firstStep.kind).toBe('build');
    expect(firstStep.prompt).toBeNull();

    const userRows = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, newBuildId))
      .all()
      .filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(0);

    await waitFor(() => stub.requests.length >= 2, 120_000);
    for (const req of stub.requests) {
      const userMessages = req.messages.filter((m) => m.role === 'user');
      expect(userMessages.length).toBeGreaterThan(0);
      for (const m of userMessages) {
        expect(userWireText(m)).toBe(TASK_TEXT);
      }
      expect(JSON.stringify(req)).not.toContain('上一轮执行失败');
    }
  }, 240_000);
});
