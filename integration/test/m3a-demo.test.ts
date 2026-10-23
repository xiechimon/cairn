// M3a demo（#79 票面）：server 派 step → daemon 真执行（pi 0.86.0 经
// AgentBackend 缝，stub provider 供流）→ transcript 经 upload-urls 回传落库。
// 同测覆盖：claim/wake 时序对照 r3 §1–§2（~75s 节奏的缩短时标同构实测 +
// wake 低延迟派发端到端时延）与 T2 的 continue-session 面（合并轮/驳回轮
// 复用同 conv pi 会话的宿主 durable 编排证据；崩溃 recover 面 = crash-recover.test.ts）。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { step as stepTable, tokenUsage } from '../../apps/server/src/db/schema.js';
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

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let buildId = '';
let todoId = '';
const timing: Record<string, number> = {};

beforeAll(async () => {
  stub = await startStubLlm([
    // #703 产物闸：stub 必须走真产物路（m3b 同款）——bash 写 plan.md（闸 1
    // 判据）+ bash 改 README（闸 2 判据）；纯文本轮的空产物步现在过不了闸。
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: `cat > plan.md <<'EOF'\n# 方案\n\nContext: 探针任务，README 当前无探针行。\nChanges: 在 README.md 追加一行 m3a probe。\nEdge cases: 无。\nVerification: 查 README.md 末行。\nEOF`,
        },
      },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "m3a probe line\\n" >> README.md' } },
    },
    { content: '修改已完成并验证通过。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  const home = mkdtempSync(join(tmpdir(), 'cairn-it-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'it-mbp' },
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
});

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

describe('M3a demo：server 派 step → daemon 真执行 → transcript 回传落库', () => {
  test('规划步全链（wake 低延迟派发 + pi 真会话 + upload-urls 落库 + phase→confirm）', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: '探针任务',
      spec: '在 README 写一行探针。',
    });
    todoId = world.todoId;
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    const t0 = Date.now();
    await waitFor(() => server.todoPhase(todoId) === 'confirm', 120_000);
    timing.wakeToConfirmMs = Date.now() - t0;

    // —— daemon.log canon 行序（02 §5.4/§5.7）——
    // `finished` = 步生命周期末行，落盘在 done ack 之后（响应回程 + journal 收尾）；
    // phase 可见瞬间与日志写入之间存在调度间隙（CI 并行负载下放大），先等末行
    // 落盘再断言全序——等待即覆盖前序各行（02 §5.7 行序 canon）。
    await waitFor(() => logLines().some((l) => l.includes('finished (0 running)')), 30_000);
    const lines = logLines();
    for (const canon of [
      'Loading pi runtime…',
      'Enrolled in team',
      'Online (machineId=',
      '[recover] no pending steps found',
      '[wake] push channel connected',
      'claim step=',
      `step `,
      'using model stub-gw/stub-model',
      '[workspace] 准备工作区...',
      `new session ${buildId}`,
      'finished (0 running)',
    ]) {
      expect(
        lines.some((l) => l.includes(canon)),
        `missing canon line: ${canon}`,
      ).toBe(true);
    }

    // —— transcript 回传落库（02 §1.3：经 upload-urls 预签名上传）——
    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const messages = (msgs.body as { messages: { role: string; content: unknown }[] }).messages;
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    const assistant = messages.filter((m) => m.role === 'assistant');
    expect(assistant.length).toBeGreaterThan(0);
    expect(JSON.stringify(assistant)).toContain('方案已就绪');

    // —— token 记账（02 §6.2 build × model × 四维）——
    const usage = server.db.select().from(tokenUsage).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ buildId, model: 'stub-gw/stub-model' });
    expect((usage[0]!.input ?? 0) + (usage[0]!.output ?? 0)).toBeGreaterThan(0);

    // —— step journal 收尾清空 + step 行 sessionId 持久（continue 解析键）——
    const steps = server.db.select().from(stepTable).all();
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(steps[0]!.sessionId).toBeTruthy();

    // —— pi 真会话输入面：systemPrompt（agent 职责注入）+ 任务文本 ——
    const first = stub.requests[0]!;
    const flat = JSON.stringify(first.messages);
    expect(flat).toContain('集成测试执行 Agent');
    expect(flat).toContain('探针任务');
    expect(flat).toContain('在 README 写一行探针。');
  }, 150_000);

  test('确认 → 执行步 = continue session（同 conv pi 会话复用，02 §4.2/§5.7；T2 证据 A）', async () => {
    const confirmed = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmed.status).toBe(202);
    await waitFor(() => server.todoPhase(todoId) === 'review', 120_000);

    expect(logLines().some((l) => l.includes(`continue session ${buildId}`))).toBe(true);
    // 会话续接证据：执行步的 LLM 请求携带规划轮历史（跨 step 的 pi 会话
    // 持久化）——requests[0..1] = 规划步（bash 写 plan.md + 收尾文本），
    // requests[2] = 执行步续会话。
    const second = stub.requests[2]!;
    expect(JSON.stringify(second.messages)).toContain('方案已就绪');
    expect(second.messages.length).toBeGreaterThan(stub.requests[0]!.messages.length);
  }, 150_000);

  test('claim 节奏 = server hold 同构（r3 §1.5 ~75–76s 的缩短时标实测；生产默认 75s 在 wire 测钉死）', async () => {
    const before = server.claimCount();
    await new Promise((r) => setTimeout(r, 3_200));
    const claims = server.claimCount() - before;
    timing.idleClaimsIn3200ms = claims;
    // hold = 1s：3.2s 窗口 ≈ 3 次空手长轮询（节奏 ≈ hold，容差 ±1）。
    expect(claims).toBeGreaterThanOrEqual(2);
    expect(claims).toBeLessThanOrEqual(5);
  }, 30_000);

  test('wake 低延迟派发时延证据落盘（票面 AC：claim/wake 时序对照实测）', () => {
    // 规划步从 POST builds 到 phase=confirm 的端到端时延（含 pi 真会话建立 +
    // stub LLM 往返 + transcript 回传）——远小于 75s 空转节奏 = wake 通道生效。
    expect(timing.wakeToConfirmMs).toBeLessThan(60_000);
    process.stdout.write(
      `\n[timing] wake→confirm(含 pi 真执行) = ${timing.wakeToConfirmMs}ms; idle claim cadence(hold=1s) = ${timing.idleClaimsIn3200ms}/3.2s\n`,
    );
  });
});
