// W3 steer E2E（真 server + 真 daemon + pi + 门控 stub LLM，06 册 D9 / spec
// #277）：building 态发消息的全链焊点——POST /conversations/{id}/messages →
// steer_pending 单槽 + machine stream steer 信号 → daemon 拉取-确认 →
// pi `session.steer`（#278 server 写面 × #279 daemon 接线的端到端证明；
// composer 调用面在 web（#280 本票），REST 形状与其一致）。
// 失败方式（spec #277 Testing Decisions 5 的全链化）：
//   1. 送达：daemon.log `steer delivered`（真实 pi steer 调用成功落日志）
//   2. 呈现：GET messages 面用户行在位
//   3. 门：确认后（无在跑步）POST → 409 不静默
//   4. 步收尾不受扰：延迟窗过后 done → phase confirm

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
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
let home: string;

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

beforeAll(async () => {
  // 门控轮：延迟 8s 的工具轮——期间步 claimed、pi 会话在跑，POST steer 窗口。
  // #703 产物闸：bash 写 plan.md 让规划步有真产物（纯文本轮过不了闸 1）。
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command:
            "printf '# 方案\n\nContext: steer 探针。\nChanges: README 加一行。\nVerification: 读回 README.md。\n' > plan.md",
        },
      },
      delayMs: 8_000,
    },
    { content: '收到，补上。' },
  ]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-w3-steer-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'w3-steer-mbp',
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

describe('W3 steer E2E：building 态发消息 → pending → 信号 → 拉取-确认 → session.steer', () => {
  test('全链送达 + 呈现 + 收尾不受扰 + 门拒绝', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: 'steer 探针',
      spec: '写一行 steer 探针。',
    });
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    expect(started.status).toBe(201);
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    // daemon 领步 → pi 会话开（stub 延迟窗内步在跑）。
    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 30_000);

    // 发送（主链）：POST → 201（claimed 步门收）。
    const sent = await api(server.url, 'POST', `/api/conversations/${buildId}/messages`, {
      content: '顺便把测试补上',
    });
    expect(sent.status).toBe(201);

    // 送达（失败方式 1）：真实链 = SSE steer 事件 → 拉取-确认 → pi steer。
    await waitFor(() => logLines().some((l) => l.includes('steer delivered')), 30_000);

    // 呈现（失败方式 2）：GET messages 面用户行。
    const face = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const faceBody = face.body as { messages: { role: string; content: unknown }[] };
    expect(faceBody.messages.some((m) => m.role === 'user' && m.content === '顺便把测试补上')).toBe(
      true,
    );

    // 收尾不受扰（失败方式 4）：延迟窗过后步 done → phase confirm。
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);

    // 门（失败方式 3）：确认后（无在跑步）再发 → 409 不静默。
    const late = await api(server.url, 'POST', `/api/conversations/${buildId}/messages`, {
      content: '晚到的一条',
    });
    expect(late.status).toBe(409);
    expect(Object.keys(late.body as object)).toEqual(['error']);
  }, 240_000);
});
