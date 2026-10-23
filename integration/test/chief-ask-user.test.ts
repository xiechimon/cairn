// #1049 结构化问答全链（真 server + 真 daemon + pi + stub LLM）：
// chief 模型调 ask_user（结构化：单选 + 多选 + 自由文本一次三问）→ runner
// 拦截面走 POST /machine/ask 阻塞通道 → 问答卡行 + 通知落库 → 测试代用户经
// web 答题端点作答 → 同一 step 内继续（D2：答完同回合收尾，不另开回合）。
// 钉住票面验收的服务器/daemon 半边：
// - 阻塞语义：等答期间 step 仍 claimed、thread.activeRun 不清空；
// - D3：无人答时永不自动拍板（pending 不翻终态）；
// - D4：同 requestId 重投幂等（不叠卡；重投者拿到同一份答案）；
// - cancel：用户取消 → 工具结果 cancelled → 模型收束同回合。
// claude-code 后端承载面（in-process MCP 工具调用无超时阻塞）由
// apps/daemon test/claude-t4-tools.test + docs/verify/1049 真实探针覆盖。

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
} from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const ASK_ARGS = {
  questions: [
    {
      header: '缩进',
      question: 'Tabs 还是 spaces？',
      options: [{ label: 'Tabs' }, { label: 'Spaces', description: '软缩进' }],
    },
    {
      header: '优先级',
      question: '本轮先做哪件事？',
      multiSelect: true,
      options: [{ label: '先修测试' }, { label: '先写文档' }],
    },
    { header: '备注', question: '有什么要补充的吗？', options: [] },
  ],
};

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
/** daemon 机的机器 token（machine.json；D4 重投直接以它的身份打机器面）。 */
let machineToken = '';

function askRowsOf(threadId: string) {
  return server.db
    .select()
    .from(chiefMessage)
    .where(eq(chiefMessage.threadId, threadId))
    .all()
    .filter((r) => r.id.startsWith('ask-'));
}

/** 等谓词产出非 null 值（helpers.waitFor 只吃 boolean）。 */
async function waitForValue<T>(
  fn: () => T | null,
  timeoutMs = 60_000,
  intervalMs = 100,
): Promise<T> {
  let last: T | null = null;
  await waitFor(
    () => {
      last = fn();
      return last !== null;
    },
    timeoutMs,
    intervalMs,
  );
  return last as T;
}

async function teamApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api(server.url, method, path, body);
  return { status: res.status, body: (res.body ?? {}) as Record<string, unknown> };
}

/** 机器面一次 ask 调用（D4 重投；holdMs=0 建卡即回 pending）。 */
async function machineAskOnce(
  stepId: string,
  requestId: string,
  holdMs = 0,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${server.url}/api/machine/ask/${stepId}?holdMs=${holdMs}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${machineToken}`,
    },
    body: JSON.stringify({ requestId, questions: ASK_ARGS.questions }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  stub = await startStubLlm([
    // 回合 1（两轮）：ask_user 提问 → 答后收尾。回合 2（取消路径）同脚本
    // 重放（stub 轮序按请求消耗，两条 test 各吃两轮）。
    { toolCall: { name: 'ask_user', arguments: ASK_ARGS } },
    { content: '已收到你的答复，本轮照此执行。' },
    { toolCall: { name: 'ask_user', arguments: ASK_ARGS } },
    { content: '已收到你的答复，本轮照此执行。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-ask-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'ask-mbp' },
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
  await waitForValue(() => {
    try {
      machineToken = (
        JSON.parse(readFileSync(join(home, 'machine.json'), 'utf8')) as { token: string }
      ).token;
      return machineToken;
    } catch {
      return null;
    }
  }, 30_000);
}, 120_000);

/** 诊断快照：daemon.log 尾部（失败路径收尾前先留底，stop 卡死也有得看）。 */
function diagTail(): string {
  try {
    return readFileSync(join(home, 'daemon.log'), 'utf8').split('\n').slice(-50).join('\n');
  } catch {
    return '(daemon.log unreadable)';
  }
}

afterAll(async () => {
  // 先留诊断（m4a 同款 + 快照先于 teardown：stop 卡死不丢证据）。
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail()}\n`,
  );
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('#1049 chief ask_user 阻塞问答全链（pi 后端）', () => {
  test('问 → 卡（行+通知）→ 答卡 → 同一回合继续（D2/D3/D4）', async () => {
    const patch = await teamApi('PATCH', `/api/teams/${server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);
    const sent = await teamApi('POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: '开工前先问清楚三件事',
    });
    expect(sent.status).toBe(201);
    const threadId = (sent.body as { thread: { id: string } }).thread.id;

    // 问答卡出现（stub 轮 1 → ask_user 落行）。
    const askRow = await waitForValue(() => askRowsOf(threadId)[0] ?? null);
    const requestId = askRow.id;
    const content = JSON.parse(askRow.content as string) as {
      status: string;
      questions: unknown[];
    };
    expect(content.status).toBe('pending');
    expect(content.questions).toHaveLength(3);

    // D2 阻塞语义：等答期间 step 仍 claimed、activeRun 不清空。
    const midStep = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .find((st) => st.kind === 'chief');
    expect(midStep?.status).toBe('claimed');
    const midThread = server.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, threadId))
      .get();
    expect(midThread?.activeRun).not.toBeNull();

    // 通知面（问 = 打扰面，r5 §7.2 chief_message）。
    const notif = server.db
      .select()
      .from(notificationTable)
      .all()
      .find((n) => n.type === 'chief_message' && n.entityId === threadId);
    expect(notif).toBeDefined();

    // D4 重投幂等：以 daemon 机身份同 requestId 再打一次（模拟连接断开
    // 重投）——不叠卡，返回 pending。
    const reAsk = await machineAskOnce(midStep?.id ?? '', requestId);
    expect(reAsk.status).toBe(200);
    expect(reAsk.body.status).toBe('pending');
    expect(askRowsOf(threadId)).toHaveLength(1);

    // D3：无人答时永不自动拍板——2s 后仍是 pending。
    await new Promise((r) => setTimeout(r, 2_000));
    const stillRow = askRowsOf(threadId)[0];
    expect((JSON.parse(stillRow?.content as string) as { status: string }).status).toBe('pending');

    // web 答题：三问齐答（单选 + 多选 + 自由文本）。
    const answered = await teamApi(
      'POST',
      `/api/teams/${server.teamId}/chief/threads/${threadId}/questions/${requestId}/answer`,
      {
        answers: [
          { header: '缩进', choices: ['Spaces'] },
          { header: '优先级', choices: ['先修测试', '先写文档'] },
          { header: '备注', text: '按优先级来' },
        ],
      },
    );
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe('answered');

    // D2 同回合继续：步不换、不增，收尾文本落库，步 done。
    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);
    const steps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .filter((st) => st.kind === 'chief');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('done');
    expect(steps[0]?.id).toBe(midStep?.id);
    const flat = JSON.stringify(
      server.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all(),
    );
    expect(flat).toContain('已收到你的答复');
    // 问答行翻 answered，答案内嵌（choices + text 双形）。
    const finalContent = JSON.parse(askRowsOf(threadId)[0]?.content as string) as {
      status: string;
      answers: { choices?: string[]; text?: string }[];
    };
    expect(finalContent.status).toBe('answered');
    expect(finalContent.answers?.[0]?.choices).toEqual(['Spaces']);
    expect(finalContent.answers?.[1]?.choices).toEqual(['先修测试', '先写文档']);
    expect(finalContent.answers?.[2]?.text).toBe('按优先级来');
  }, 180_000);

  test('用户取消 → cancelled 工具结果 → 模型同回合收束（D4 用户侧出口）', async () => {
    const sent = await teamApi('POST', `/api/teams/${server.teamId}/chief/threads`, {
      content: '再问一次，这次我会取消',
    });
    const threadId = (sent.body as { thread: { id: string } }).thread.id;
    const askRow = await waitForValue(() => askRowsOf(threadId)[0] ?? null);

    const cancelled = await teamApi(
      'POST',
      `/api/teams/${server.teamId}/chief/threads/${threadId}/questions/${askRow.id}/cancel`,
      {},
    );
    expect(cancelled.status).toBe(200);

    // 等待的机器通道拿到 cancelled → 模型收尾（stub 轮 2）→ 同一步 done。
    await waitFor(() => {
      const th = server.db.select().from(chiefThread).where(eq(chiefThread.id, threadId)).get();
      return th?.lastTurnAt != null && th.activeRun === null;
    }, 120_000);
    const steps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, threadId))
      .all()
      .filter((st) => st.kind === 'chief');
    expect(steps).toHaveLength(1);
    expect(steps[0]?.status).toBe('done');
    expect(
      (JSON.parse(askRowsOf(threadId)[0]?.content as string) as { status: string }).status,
    ).toBe('cancelled');
    const flat = JSON.stringify(
      server.db.select().from(chiefMessage).where(eq(chiefMessage.threadId, threadId)).all(),
    );
    expect(flat).toContain('已收到你的答复');
  }, 180_000);
});
