// T2 证据 B（00/T2 时间盒，03 M3 首张票）：宿主 durable 编排的崩溃恢复面——
// daemon 子进程 SIGKILL 于步执行中 → 重启 → `[recover]` journal 对账 →
// continue session 真续跑 → done → phase 推进。
// 实测边界（pi ≥1.0，#923 复核）：会话 jsonl 自 user 消息起落盘（pi #10000
// ——「keeps the prompt on disk if the first turn never completes」），步中
// 崩溃时会话文件在位可续，recover 走 continue session 真续跑。journal 兜底面
// （会话文件缺失/不可续 → continue unavailable 回退 new session 重发任务文本，
// 跨机认领即此形态，#862 T1）由 apps/daemon/test/runner-resume-note.test.ts
// 单测钉住；跨已完成步的 continue session（合并轮/驳回轮复用，02 §4.2）在
// m3a-demo 实测通过。
// 步队列 server 持有（02 §4.2/A6）+ 会话持久化索引宿主自持（00/D3）。

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_VARS } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { step as stepTable } from '../../apps/server/src/db/schema.js';
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

const DAEMON_DIR = fileURLToPath(new URL('../../apps/daemon', import.meta.url));

let stub: StubLlm;
let server: RealServer;
let home: string;
const children: ChildProcess[] = [];

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await server?.close();
  await stub?.close();
});

function spawnDaemon(): ChildProcess {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/cli.ts',
      'start',
      '--foreground',
      '--server',
      server.url,
      '--api-key',
      server.apiKey,
      '--team',
      server.teamId,
      '--name',
      'crash-mbp',
    ],
    {
      cwd: DAEMON_DIR,
      env: {
        ...process.env,
        [ENV_VARS.home]: home,
        // 代理变量清空：本机 dev 代理不得介入 localhost 集成链路。
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.push(child);
  return child;
}

function logLines(): string[] {
  return daemonLogLines(join(home, 'daemon.log'));
}

describe('崩溃恢复（T2：AgentSession 缝 × 宿主 durable 编排）', () => {
  test('SIGKILL 于步中 → 重启 → recover 对账 → continue session 续跑 → confirm', async () => {
    stub = await startStubLlm([
      // 第一轮慢响应：制造崩溃窗口（session 已建、步未收尾）——响应本体不被
      // 消费（daemon 先死），内容无关紧要。
      { content: '第一轮响应（崩溃前）。', delayMs: 6_000 },
      // #703 产物闸：恢复后续跑要真产 plan.md（纯文本轮过不了闸 1）。
      {
        toolCall: {
          name: 'bash',
          arguments: {
            command: `cat > plan.md <<'EOF'\n# 方案\n\nContext: 崩溃恢复探针。\nChanges: README 加一行。\nVerification: 读回 README.md。\nEOF`,
          },
        },
      },
      { content: '恢复后续跑完成。' },
    ]);
    server = await bootRealServer({ providerBaseUrl: stub.url, claimHoldMs: 500 });
    home = mkdtempSync(join(tmpdir(), 'pacman-crash-home-'));
    const world = await seedWorld(server.url, server.teamId, {
      title: '崩溃恢复探针',
      spec: '写一行崩溃恢复探针。',
    });

    const first = spawnDaemon();
    await waitFor(() => logLines().includes('[wake] push channel connected'), 60_000);

    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    });
    const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    // 等 pi 会话建立且首条 LLM 请求已发出（journal 已落 sessionId + prompt
    // 快照）后硬杀——此刻会话 jsonl 已带 user 首条消息落盘（pi #10000：
    // 「keeps the prompt on disk if the first turn never completes」），
    // 恢复走 continue session 真续跑。
    await waitFor(() => logLines().some((l) => l.includes(`new session ${buildId}`)), 90_000);
    await waitFor(() => stub.requests.length >= 1, 30_000);
    await new Promise((r) => setTimeout(r, 300));
    first.kill('SIGKILL');
    await new Promise<void>((resolve) => first.once('exit', () => resolve()));

    // server 侧步仍 claimed（步队列 server 持有 = durable 编排真值面）。
    const midSteps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(midSteps).toHaveLength(1);
    expect(midSteps[0]!.status).toBe('claimed');
    expect(server.todoPhase(world.todoId)).toBe('planning');

    // 重启：recover 对账 → continue session 续跑（同 home = 同 journal/会话索引）。
    const second = spawnDaemon();
    await waitFor(
      () => logLines().some((l) => l.includes('[recover] 1 pending step(s) found')),
      60_000,
    );
    await waitFor(() => server.todoPhase(world.todoId) === 'confirm', 120_000);
    // `finished` 落盘在 done ack 之后，phase 可见 ≠ 日志已写（调度间隙，CI 并行
    // 负载下放大）——先等末行再断言（m3a-demo 同款竞态，02 §5.7 行序 canon）。
    await waitFor(() => logLines().some((l) => l.includes('finished (0 running)')), 30_000);

    const lines = logLines();
    // 真续跑：会话文件自 user 首条落盘（pi #10000）→ recover 续接成功，
    // continue 行在位、new session 只属首个 daemon（journal 兜底回退面由
    // runner-resume-note.test.ts 单测钉住，此处不发生）。
    expect(lines.some((l) => l.includes(`continue session ${buildId}`))).toBe(true);
    expect(lines.some((l) => l.includes('continue session unavailable'))).toBe(false);
    expect(lines.filter((l) => l.includes(`new session ${buildId}`))).toHaveLength(1);
    expect(lines.some((l) => l.includes('finished (0 running)'))).toBe(true);
    // 任务文本在续跑首轮请求可见（引擎持久面：会话历史自带原 user 消息；
    // journal 快照重发同文——两面同证）。
    expect(JSON.stringify(stub.requests[1]?.messages ?? [])).toContain('崩溃恢复探针');

    // 步收尾 + sessionId 持久（后续合并轮 continue 的解析键）。
    const steps = server.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
    expect(steps[0]!.status).toBe('done');
    expect(steps[0]!.sessionId).toBeTruthy();

    // transcript 经 upload-urls 落库（回传面在恢复路径同样成立）。
    const msgs = await api(server.url, 'GET', `/api/conversations/${buildId}/messages`);
    expect(
      JSON.stringify((msgs.body as { messages: unknown[] }).messages).includes('崩溃恢复探针'),
    ).toBe(true);

    second.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5_000);
      second.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    // #691：SIGTERM 面的信号名进退出行（canonical 后缀），事后可考。
    expect(logLines()).toContain('[machine] Shutting down… (SIGTERM)');
  }, 240_000);
});
