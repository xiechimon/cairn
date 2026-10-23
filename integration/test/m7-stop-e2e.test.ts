// M7 stop E2E（真 server + 真 daemon + pi + 门控 stub LLM，#308 / r9 §3.3）：
// 停止钮全链焊点——POST /api/builds/{id}/stop → stop_pending 单槽 + machine
// stream stop 信号 → daemon 拉取-确认 → live.stop() 中断 pi 会话 →
// done(stopped) 回报 → server 落账（step 'stopped' + build.errorMessage
// '已取消' + gate 回落）。pending 步即时取消面 = server 单测（stop.test.ts），
// 本链只走 claimed 步（live daemon 下 pending 窗口毫秒级，时序不可钉）。
// 失败方式（08 册 §5 全链化，w3-steer-e2e 同律）：
//   1. 送达：daemon.log `stop delivered` + `step stopped by user`（真实 pi
//      abort 成功落日志）
//   2. 落账：GET builds/{id}/steps → status 'stopped'；GET builds/{id} →
//      errorMessage '已取消'
//   3. gate 回落：首轮 plan 步被停 → todo phase 落 prevPhase（'todo'）
//   4. 过程行保留：停止步 transcript 终稿上传照走（GET messages 有任务行）
//   5. 门：落账后再 POST stop → 409 不静默

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
  // 门控轮：延迟 8s 的单轮——期间步 claimed、pi 会话在跑，POST stop 窗口。
  stub = await startStubLlm([{ content: '这轮永远不会说完…', delayMs: 8_000 }]);
  server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  home = mkdtempSync(join(tmpdir(), 'cairn-m7-stop-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'm7-stop-mbp',
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

describe('M7 stop E2E：停止钮 → pending → 信号 → 拉取-确认 → pi abort → done(stopped) → 落账', () => {
  test('全链送达 + 落账 + gate 回落 + 过程行保留 + 门拒绝', async () => {
    const world = await seedWorld(server.url, server.teamId, {
      title: 'stop 探针',
      spec: '写一行 stop 探针。',
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

    // 停止（主链）：POST → 202 delegated（claimed 步 = 机器信号面）。
    const stopped = await api(server.url, 'POST', `/api/builds/${buildId}/stop`, {
      discard: true,
    });
    expect(stopped.status).toBe(202);
    expect(stopped.body).toEqual({ delegated: true });

    // 送达（失败方式 1）：真实链 = SSE stop 事件 → 拉取-确认 → pi abort。
    await waitFor(() => logLines().some((l) => l.includes('stop delivered step=')), 30_000);
    await waitFor(() => logLines().some((l) => l.includes('step stopped by user')), 30_000);

    // 落账（失败方式 2/3）：step 'stopped' + build '已取消' + gate 回落
    // prevPhase（首轮 plan 步 → 'todo'）。
    await waitFor(() => server.todoPhase(world.todoId) === 'todo', 60_000);
    const steps = await api(server.url, 'GET', `/api/builds/${buildId}/steps`);
    const stepRows = steps.body as { status: string }[];
    expect(stepRows.some((s) => s.status === 'stopped')).toBe(true);
    const buildFace = await api(server.url, 'GET', `/api/builds/${buildId}`);
    expect((buildFace.body as { errorMessage: string | null }).errorMessage).toBe('已取消');

    // 过程行保留（失败方式 4）：停止步的 transcript 终稿上传照走。
    const messages = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    const face = messages.body as { messages: { role: string; content: unknown }[] };
    expect(
      face.messages.some((m) => m.role === 'user' && String(m.content).includes('stop 探针')),
    ).toBe(true);

    // 门（失败方式 5）：落账后（无活动步）再停 → 409 不静默。
    const late = await api(server.url, 'POST', `/api/builds/${buildId}/stop`, { discard: true });
    expect(late.status).toBe(409);
    expect(Object.keys(late.body as object)).toEqual(['error']);
  }, 240_000);
});
