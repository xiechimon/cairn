// M4a Chief E2E（真 server + 真 daemon + pi + stub LLM）：验证 daemon 侧 chief
// 执行缝——claim chief 步 → pi 会话挂 remoteTools（defineTool customTools 映射，
// parameters = 原始 JSON Schema）→ 模型调 relay 工具 → POST /machine/tool/{stepId}
// {name,params} → 服务端 executeChiefTool → {text} 回 pi → 收尾文本 → done →
// finishChiefTurn（thread sessionId/lastTurnAt）+ transcript 落 chief_message +
// chief_message 通知。这是「pi customTools 接受原始 JSON Schema 参数」缝的实证
// （04 §1 A4：不冒充实测——此测跑通即坐实该缝）。
//
// stub 工具轮用读侧 `projects`（无动态参数，replaySafe）——create_todo 的溯源
// 落库已在 server 侧 m4a-chief-loop.test.ts 直证；本测证 pi↔relay 往返本身。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  chiefMessage,
  chiefThread,
  notification as notificationTable,
  step as stepTable,
  tokenUsage,
} from '../../apps/server/src/db/schema.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  waitFor,
} from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let threadId = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  stub = await startStubLlm([
    // chief 回合轮 1：调用 relay 读工具 `projects`（pi customTool → relay → server）。
    { toolCall: { name: 'projects', arguments: {} } },
    // 轮 2：拿到工具结果后收尾文本。
    { content: '已查看团队项目清单。有什么可以帮你的？' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-m4a-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'm4a-mbp' },
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
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('M4a Chief E2E：pi 会话 + remoteTools relay 往返（02 §4.3/r5 §3.1）', () => {
  test('绑定 → 发消息 → claim chief 步 → pi relay 工具 → done → chief_message 落库', async () => {
    // 绑定 chief agent（PATCH /chief，r5 §2）。
    const patch = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);

    // 发消息 → 建线程 + chief 步入队 + 机器 wake。
    const sent = await api(server.url, 'POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: '团队里现在有哪些项目？',
    });
    expect(sent.status).toBe(201);
    threadId = (sent.body as { thread: { id: string } }).thread.id;
    expect(threadId.startsWith('chief-')).toBe(true);

    // daemon 领 chief 步 → pi 会话（new session chief-…）→ relay projects → 收尾。
    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);

    // daemon.log canon：conv = chief-<threadId>（r5 §3.1）。
    const lines = logLines();
    expect(lines.some((l) => l.includes(`for conv ${threadId}`))).toBe(true);
    expect(lines.some((l) => l.includes(`new session ${threadId}`))).toBe(true);
    expect(lines.some((l) => l.includes('using model stub-gw/stub-model'))).toBe(true);

    // chief 步收尾 done。
    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).all();
    expect(steps.some((st) => st.kind === 'chief' && st.status === 'done')).toBe(true);
    // thread.sessionId 落值（continue session 复用面）。
    const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get()!;
    expect(th.sessionId).not.toBe('');

    // chief_message 落库：assistant 收尾文本（transcript 上传 → chief 分支）。
    const msgs = server.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, threadId))
      .all();
    const flat = JSON.stringify(msgs.map((m) => m.content));
    expect(flat).toContain('已查看团队项目清单');
    // relay 工具行落库（projects 调用，live reportTool → chief_message）。
    expect(flat).toContain('projects');

    // chief_message 通知（r5 §7.2：snippet = 消息全文）。
    const notif = server.db
      .select()
      .from(notificationTable)
      .all()
      .find((n) => n.type === 'chief_message' && n.entityId === threadId);
    expect(notif).toBeDefined();
    expect(notif!.snippet).toContain('已查看团队项目清单');

    // token 记账：buildId = chief conv id（context.tokens 数据源）。
    const usage = server.db.select().from(tokenUsage).where(eq(tokenUsage.buildId, threadId)).all();
    expect(usage.length).toBeGreaterThanOrEqual(1);
  }, 150_000);
});
