// #720 负例 E2E：空白反馈的重启轮不注入空指令（真 server + 真 daemon + pi +
// 门控 stub LLM）。API 层 `feedback: z.string().min(1)` 已拒真空串，但空白串
// （'  '）能过 schema 且 UI composer 的 `text !== ''` 判定也拦不住——server 守卫
// （feedback.trim() === ''）必须把它收口成纯重启轮：不写 step instruction、不落
// 空白用户行；runner 投递纯任务文本，「用户反馈：「」」空壳指令不出现。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 空壳指令进会话：空白反馈 → 会话 prompt 携「上一轮失败…用户反馈：「」」
//      模板（agent 收到一条没有内容的「反馈」）
//   2. 空白用户行落库：restart 写一条 content='  ' 的 user 消息行（空气泡）
//   3. 误伤常规重启：非空白反馈路径（m7-failed-send-e2e 覆盖）不因守卫退化
// 本文件只钉 1/2 的负例面。

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

/** user wire 消息文本（openai 双形：纯 string 或 text parts 数组——pi 会话
 * 首条 user 恒走 parts 形，m7-failed-send 同款实测钉）。 */
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
  // 失败轮：build 步 provider 400（不可重试）→ todo failed；空白反馈重启轮：
  // 一轮文本应答（内容无关紧要——断言的是请求体里 user 消息长什么样）。
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

describe('空白反馈重启轮（#720 负例）：不注入空指令', () => {
  test('空白 feedback → 纯重启轮：无 instruction、无空白用户行、会话 prompt = 任务文本', async () => {
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

    // 失败方式 1 的 DB 面：首步不带 instruction（prompt 列 null）。
    const firstStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, newBuildId))
      .orderBy(asc(stepTable.createdAt))
      .all()[0]!;
    expect(firstStep.kind).toBe('build');
    expect(firstStep.prompt).toBeNull();

    // 失败方式 2：不落空白用户行（反馈行缺席，不是 content='   ' 的空气泡）。
    const userRows = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, newBuildId))
      .all()
      .filter((m) => m.role === 'user');
    expect(userRows).toHaveLength(0);

    // 失败方式 1 的会话面：重启轮请求已到 stub；全部 user 消息 = 纯任务文本，
    // 任何请求都不含重启指令模板（空壳不出现）。
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
