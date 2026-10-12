// #1148 E2E（真 server + 真 daemon + pi + stub LLM）：chief 满载立即被领 +
// 端口基座分段 + env 兜底取值序。三条验收（票面）：
//   1. 上限 1、一个 worker 在跑时：chief 回合立即被领（不被卡）；第二个
//      worker 不领。
//   2. 两个并发 worker 步的环境里 PACMAN_PORT_BASE 不同段（槽位 ×100：
//      20000/20100/20200…）。
//   3. env 覆盖生效序（env > DB > 默认）实测一遍（DB 2 / env 1 → 实际 1）。
// 失败方式（先于实现固化，实现前本文件全红）：
//   - chief 满载饿死回归：cap 1 + worker 在跑时 chief 步不被领。
//   - 端口基座串槽：并发 worker 步 env 同段（或无 env）。
//   - env 与 DB 打架时取值序漂移：env=1 不压 DB=2。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import {
  DAEMON_MAX_CONCURRENT_ENV,
  type MachineHandle,
  runMachine,
} from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import {
  build as buildTable,
  machine as machineTable,
  step as stepTable,
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

interface Stack {
  stub: StubLlm;
  server: RealServer;
  handle: MachineHandle;
  paths: StatePaths;
  home: string;
  lines(): string[];
  machineId: string;
  close(): Promise<void>;
}

const stacks: Stack[] = [];

async function bootStack(opts: {
  responses: Parameters<typeof startStubLlm>[0];
  capEnv?: NodeJS.ProcessEnv;
}): Promise<Stack> {
  const stub = await startStubLlm(opts.responses);
  const server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 1_000 });
  const home = mkdtempSync(join(tmpdir(), 'pacman-1148-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'pb-mbp' },
    {},
  );
  const paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  const handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    ...(opts.capEnv !== undefined ? { capEnv: opts.capEnv } : {}),
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(
    () => daemonLogLines(paths.daemonLog).includes('[wake] push channel connected'),
    30_000,
  );
  const machineId = server.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'pb-mbp'))
    .get()!.id;
  const stack: Stack = {
    stub,
    server,
    handle,
    paths,
    home,
    lines: () => daemonLogLines(paths.daemonLog),
    machineId,
    close: async () => {
      await handle.stop();
      await handle.done;
      await server.close();
      await stub.close();
      rmSync(home, { recursive: true, force: true });
    },
  };
  stacks.push(stack);
  return stack;
}

afterAll(async () => {
  for (const s of stacks) {
    if (s === lastFailedStack) {
      const steps = s.server.db.select().from(stepTable).all();
      process.stdout.write(
        `\n[diag] steps: ${JSON.stringify(
          steps.map((st) => ({ id: st.id, kind: st.kind, status: st.status })),
        )}\n[diag] builds: ${JSON.stringify(
          s.server.db
            .select()
            .from(buildTable)
            .all()
            .map((b) => ({ id: b.id, todoId: b.todoId, errorMessage: b.errorMessage })),
        )}\n[diag] stub requests: ${s.stub.requests.length}; flattened tails:\n${s.stub.requests
          .map((r, i) => `  [${i}] ${JSON.stringify(r.messages).slice(0, 400)}`)
          .join('\n')}\n[diag] daemon.log tail:\n${s.lines().slice(-50).join('\n')}\n`,
      );
    }
    await s.close();
  }
});

/** 失败栈的 diag 出口（waitFor 抛错时登记，afterAll 打印）。 */
let lastFailedStack: Stack | null = null;

/** 发起单 build 步（withPlan:false → 首步即 build，agent 直执行）。 */
async function startBuild(
  stack: Stack,
  title: string,
): Promise<{ todoId: string; buildId: string }> {
  const world = await seedWorld(stack.server.url, stack.server.teamId, {
    title,
    spec: '探针：跑一条命令并收尾。',
  });
  const started = await api(stack.server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
    todoIds: [world.todoId],
    assignment: { plan: null, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  expect(started.status).toBe(201);
  const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
  return { todoId: world.todoId, buildId };
}

function stepsOf(stack: Stack, buildId: string) {
  return stack.server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}

describe('#1148 E2E：端口基座分段（两个并发 worker 步不同段）', () => {
  test('两个并发 worker 步的 bash 环境里 PACMAN_PORT_BASE = 20000 / 20100', async () => {
    // stub 按请求序派发（不知请求来自哪个步）——两步并发时序交错不定，故
    // 头部铺 6 个 bash 槽（bash = 变更类工具，#703 产物闸过；两步各至少跑
    // 一次）、尾段 content 恒重复（收尾）。任一交错序下两步都「bash ≥1 次 +
    // content 收尾」。
    const bashProbe = {
      toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$PACMAN_PORT_BASE"` } },
    };
    const stack = await bootStack({
      responses: [
        bashProbe,
        bashProbe,
        bashProbe,
        bashProbe,
        bashProbe,
        bashProbe,
        { content: '探针完成。' },
      ],
    });
    const t1 = await startBuild(stack, '端口探针一');
    const t2 = await startBuild(stack, '端口探针二');
    // 两步都跑到 done（cap 默认 3 → 两步并发）。
    try {
      await waitFor(() => stepsOf(stack, t1.buildId)[0]?.status === 'done', 120_000);
      await waitFor(() => stepsOf(stack, t2.buildId)[0]?.status === 'done', 120_000);
    } catch (err) {
      lastFailedStack = stack;
      throw err;
    }
    // 并行 canon 行：两步各发射一行（(1 running) / (2 running)）。
    const lines = stack.lines();
    expect(lines.some((l) => l.includes('(1 running)'))).toBe(true);
    expect(lines.some((l) => l.includes('(2 running)'))).toBe(true);
    // 端口基座真值：bash 工具结果随第二轮请求回传 stub——两个不同段。
    const flat = JSON.stringify(stack.stub.requests.map((r) => r.messages));
    const found = [...flat.matchAll(/PB=(\d{5})/g)].map((m) => m[1]);
    expect(new Set(found)).toEqual(new Set(['20000', '20100']));
  }, 150_000);
});

describe('#1260 E2E：chief 占机器并发槽（上限 1）', () => {
  test('worker 在跑（cap 1）时 chief 排队等空位，空位即领；后来的 worker FIFO 在其后', async () => {
    const stack = await bootStack({
      responses: [
        // worker r1：延迟的 bash 轮（占住唯一 worker 槽 6s）。
        {
          delayMs: 6_000,
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$PACMAN_PORT_BASE"` } },
        },
        // chief r1：延迟 2s 的收尾文本（拉宽 claimed 观察窗——慢 runner 上纯
        // 文本回合可在一个轮询间隔（100ms）内跑完，status 窗口会被跳过）。
        { delayMs: 2_000, content: '收到，已了解当前进度。' },
        // worker r2：收尾文本。
        { content: '探针完成。' },
        // 第二个 worker 的两轮。
        {
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$PACMAN_PORT_BASE"` } },
        },
        { content: '探针完成。' },
      ],
    });
    // 上限 1（DB 写位 = 机器页同面）。
    stack.server.db
      .update(machineTable)
      .set({ maxConcurrent: 1 })
      .where(eq(machineTable.id, stack.machineId))
      .run();
    // 绑定 chief agent（r5 §2）。
    const patch = await api(stack.server.url, 'PATCH', `/api/teams/${stack.server.teamId}/chief`, {
      agent: { agentId: AGENT_ID, thinkingLevel: null },
    });
    expect(patch.status).toBe(200);

    // worker 1 在跑（唯一槽被占）。
    const w1 = await startBuild(stack, '并发探针一');
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'claimed', 30_000);

    // chief 回合入队（满载时）→ 排队等空位：#1260 起 chief 占机器并发槽，
    // cap 1 被 worker 占满即同槽互斥（旧「chief 不占槽满载立即领」语义已
    // 退役——本测试就是它的反向钉）。
    const sent = await api(
      stack.server.url,
      'POST',
      `/api/teams/${stack.server.teamId}/chief/threads`,
      { content: '现在团队里在跑什么？' },
    );
    expect(sent.status).toBe(201);
    const threadId = (sent.body as { thread: { id: string } }).thread.id;
    // 满载窗口内 chief 留 pending（worker 的 6s bash 占着唯一槽）。
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stepsOf(stack, threadId)[0]?.status).toBe('pending');

    // 第二个 worker 也不领（排在 chief 之后：FIFO 以入队时刻为序）。
    const w2 = await startBuild(stack, '并发探针二');
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stepsOf(stack, w2.buildId)[0]?.status).toBe('pending');

    // worker 收尾释放槽 → chief 空位即领（状态面与 daemon.log 持久面双取
    // 一：极快回合的 claimed→done 可能整段落在一个轮询间隔里，日志行是
    // 窗口无关的被领证据）。
    await waitFor(
      () =>
        stepsOf(stack, threadId)[0]?.status === 'claimed' ||
        stack.lines().some((l) => l.includes(`for conv ${threadId}`)),
      30_000,
    );
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'done', 120_000);

    // chief 收尾（快速文本轮）后线程闭环；空位再释放 → w2 被领并跑完。
    await waitFor(() => {
      const chiefSteps = stack.server.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, threadId))
        .all();
      return chiefSteps[0]?.status === 'done';
    }, 120_000);
    await waitFor(() => stepsOf(stack, w2.buildId)[0]?.status === 'done', 120_000);
  }, 240_000);
});

describe('#1148 E2E：env 兜底取值序（env > DB > 默认）', () => {
  test('DB 2 / env 1 → 同刻只跑 1 个 worker（env 压 DB，server 闸按自报收窄）', async () => {
    const stack = await bootStack({
      capEnv: { [DAEMON_MAX_CONCURRENT_ENV]: '1' },
      responses: [
        // worker 1 r1：延迟 bash 轮（占住 env=1 的唯一位 6s）。
        {
          delayMs: 6_000,
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$PACMAN_PORT_BASE"` } },
        },
        { content: '探针完成。' },
        // worker 2 的两轮（env 位释放后照跑）。
        {
          toolCall: { name: 'bash', arguments: { command: `printf 'PB=%s' "$PACMAN_PORT_BASE"` } },
        },
        { content: '探针完成。' },
      ],
    });
    // DB 行给 2（env 1 应压过它——取值序 env > DB）。
    stack.server.db
      .update(machineTable)
      .set({ maxConcurrent: 2 })
      .where(eq(machineTable.id, stack.machineId))
      .run();
    const w1 = await startBuild(stack, 'env 探针一');
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'claimed', 30_000);
    const w2 = await startBuild(stack, 'env 探针二');
    // env=1：worker 1 在飞期间 worker 2 留 pending（DB 的 2 不生效——env 压 DB）。
    await new Promise((r) => setTimeout(r, 1_500));
    expect(stepsOf(stack, w2.buildId)[0]?.status).toBe('pending');
    // worker 1 收尾 → 空位 → worker 2 被领并跑完。
    await waitFor(() => stepsOf(stack, w1.buildId)[0]?.status === 'done', 120_000);
    await waitFor(() => stepsOf(stack, w2.buildId)[0]?.status === 'done', 120_000);
  }, 240_000);
});
