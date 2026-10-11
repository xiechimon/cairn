// M7 失败面发送 E2E（真 server + 真 daemon + pi + 门控 stub LLM，#320 /
// r9 §3.3）：failed 相位 composer 发送的全链焊点——POST /api/builds/{id}/steps
// {action:"restart"} → 反馈消息行落新轮会话 + 首步入队（instruction 携反馈，
// revision 同缝）+ failed→queued 漏斗 → 机器领取实跑新一轮。
// 与 #308 停止钮的落态分界：停止 = 运行轮落上一完成 turn 的 gate（落态非
// failed）；restart 门只收 failed——两写面相位隔离，不共享入口。
// 失败方式（先列后写，AGENTS.md 测试规则 3）：
//   1. 静默丢稿复发：发送不落库（本 bug 现状）→ POST 后消息行必须在新轮会话
//   2. 消息不入新轮：只建 build 不插消息行 → GET messages 面 user 行在位
//   3. transcript 次序倒挂：消息 createdAt 晚于首步 → 反馈行排运行行之后
//   4. 新一轮不触发：todo 停留 failed → 漏斗推进 + daemon 实跑到 confirm
//   5. 反馈到不了 agent：首步 prompt 空 → claim instruction 位缺（db 钉）
//   6. 相位误触发：confirm/review 也走 restart → 与 revision/steer 撞写面（409 钉）
//   7. 双发竞态：连打两次发送 → 两个新 build（第二次 409 钉）
//   8. assignment/withPlan 丢失：新轮步无 agent 不可 claim → 卡死 queued
//   9. build 位错乱：latestBuildId 不指向新 build / prevPhase 不记 failed
//   10.（#720）反馈进不了 agent 会话：new session 步 prompt 只有 title+spec，
//       返工理由只落 DB —— stub LLM 请求体 + transcript wire 行双面对账

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
} from '@pacman/shared';
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

/** user wire 消息文本（openai 双形：纯 string 或 text parts 数组——pi 会话
 * 首条 user 恒走 parts 形，实测 dump 钉）。 */
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
    // 失败轮：plan 步 provider 400（不可重试类，m3b 同形）→ 步 failed → todo failed。
    { status: 400 },
    // 重启轮：bash 写 plan.md（pi 内建工具真执行）→ 收尾文本轮 → confirm。
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` },
      },
    },
    { content: '已按反馈调整，重启轮方案就绪。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'pacman-m7-restart-home-'));
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

describe('M7 失败面发送 E2E：failed 发消息 → restart → 反馈随新轮入会话 → 实跑到 confirm', () => {
  test('全链落库 + 新轮实跑 + 相位门拒绝', async () => {
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

    // 失败轮落态（失败方式 4 的前置）：provider 400 → 步 failed → todo failed。
    await waitFor(() => server.todoPhase(world.todoId) === 'failed', 150_000);

    // —— 主链：失败面发送 = restart（r9 §3.3 原站实走 steps 端点）——
    const sent = await api(server.url, 'POST', `/api/builds/${failedBuildId}/steps`, {
      action: 'restart',
      feedback: '把测试也补上',
      clientMessageId: randomUUID(),
    });
    expect(sent.status).toBe(202);
    expect(sent.body).toEqual({ delegated: true });

    // build 位（失败方式 9）：新 build ≠ 旧，prevPhase=failed，withPlan 承接，
    // latestBuildId 指向新轮；assignment 保留（失败方式 8 的 db 面）。
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

    // 消息随新轮入会话（失败方式 1/2）：反馈行落新 conv 的 transcript 读面。
    const face = await api(server.url, 'GET', `/api/conversations/${newBuildId}/messages`);
    const faceBody = face.body as { messages: { role: string; content: unknown }[] };
    expect(faceBody.messages.some((m) => m.role === 'user' && m.content === '把测试也补上')).toBe(
      true,
    );

    // 次序与 instruction 位（失败方式 3/5）：消息行 createdAt 不晚于首步；
    // 首步 prompt 携反馈（claim wire instruction 槽，revision 同缝）。
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

    // 新一轮实跑（失败方式 4/8 端到端）：机器领取 → 规划轮完成 → confirm。
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    // —— #720 对账面：反馈真的进了 agent 会话（票面验收 = transcript 可见，
    // 不是只落 DB）—— stub LLM 全量录请求体（不从截断 dump 推结论），重启轮
    // 会话首条 user 消息 = 任务文本 + 重启指令组合串（compose 单源），与
    // transcript 读面的 user-<stepId> wire 行同串。 ——
    // #1203：restart 复用轮首步是 plan 步（withPlan），daemon 投递串尾部
    // 附 plan.md 交接位置注记行（路径 = daemon home 的 plans 面，conv id =
    // build id）——stub 对账与 transcript 读面同串。
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

    // 相位门（失败方式 6/7）：phase 已离开 failed——对新 build 再发 restart、
    // 对旧 failed build 重放 restart 均 409，不产生第三个 build。
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
