// #666 回归面：方案卡收敛不再独赌 conversation stream 活着。
//
// CI 三连锤断口的确定性重放（run 37030880070 / 36995620906 / 36908878754，
// 指纹一致）：详情页 conv 流迟到建连或哑掉（服务端不向新订阅者重放），
// plan 行经 machine upload 缝静默落库、['plans'] 此前只由 conv 流的
// message/step 事件失效——相位 chip 照翻（team 流是另一条连接，todo 文档
// 事件驱动），方案卡却永远缺席；XMON-60 对账闸门恰在 confirm 相位关闭
// （非在飞），#462 看门狗要完全静默（ping 在流），三层看护全不覆盖。
// 修复后 team 流 todo/build 文档事件带 ['plans'] 失效（web 映射单源
// sse-team-events.ts；事件恒在 plan 行落库之后发布：daemon 顺序 PUT
// plan.md → done，server receivePlanUpload 同步落库 → completeStep →
// setTodoPhase → publishTodoDoc），方案卡与 chip 同事件收敛。
//
// 本测用 page.route 掐断浏览器的 conv 流端点确定性复现该断口面。
// 失败方式清单：
//   1. team 事件映射漏 ['plans'] → chip 翻「确认」而 .chat-plan-title 缺席
//      （修复前形态，本测的断口面——红）。
//   2. 掐流面误伤 REST（/api/builds/:id/plans）→ 重取拿不到数据 → 同 1 红
//      （route 模式只挂 /stream 后缀；测试内直查该 REST 200 + 1 行自证）。
//   3. 掐流没生效（route 未命中 / EventSource 意外建连）→ 测试退化成
//      happy path = 表演型绿 → 收尾断言 blocked 计数 > 0 兜住。
//   4. 规划轮根本没跑（栈面故障）→ chip 不翻，waitChip 预算红（非本测
//      断口，但同样红，不假绿）。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { AGENT_ID, api, bootRealServer, type RealServer, seedWorld, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

const PLAN_MD = [
  '# 方案',
  '',
  'Context: #666 收敛探针任务。',
  'Changes: 在 plan.md 落一版方案（无其它改动）。',
  'Edge cases: 无。',
  'Verification: 方案卡上屏即验证（读回 README.md）。',
].join('\n');

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  // 集成面文件串行（vitest.config fileParallelism:false，#349）——各自构建
  // 共享 dist 是既定形态（m5 同款）。
  const build = spawnSync('pnpm', ['--filter', '@cairn/web', 'exec', 'vite', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`web build failed:\n${build.stdout}\n${build.stderr}`);
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error(`web dist missing at ${WEB_DIST} (static hosting would 404)`);
  }
  stub = await startStubLlm([
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD}\nEOF` },
      },
    },
    { content: '方案已就绪：四段完整。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
    webDir: WEB_DIST,
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-666-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'c666' },
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
  await waitFor(() => {
    try {
      return readFileSync(paths.daemonLog, 'utf8').includes('[wake] push channel connected');
    } catch {
      return false;
    }
  }, 30_000);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

test('conv 流哑掉时，方案卡随 team 流的相位事件收敛上屏（#666）', async () => {
  // hosted 形态显式钉（m3b 同款）：provisionHostedRepo 会 seed 初始提交立
  // main——daemon worktree 契约（02 §5.5 base=origin/main）的前提。
  const { projectId, todoId } = await seedWorld(
    server.url,
    server.teamId,
    { title: '#666 收敛探针', spec: '在 plan.md 落一版方案。' },
    { repoKind: 'hosted', projectName: 'c666-convergence' },
  );
  const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: true,
  });
  expect(started.status).toBe(201);

  // 掐断 conv 流（仅 /stream 后缀；REST 与 team 流不匹配该模式）。计数兜住
  // 「掐流没生效」的表演型绿（失败方式 3）。
  let blocked = 0;
  await page.route('**/api/conversations/*/stream', (route) => {
    blocked += 1;
    void route.abort();
  });

  await page.goto(`${server.url}/app/todo/${todoId}`);
  await pexpect(page.locator('.detail-shell')).toBeVisible({ timeout: 30_000 });
  // 规划轮跑完：chip 翻「确认」（team 流 todo 事件——失败方式 4 的兜）。
  await pexpect(page.locator('.detail-chip')).toHaveText(/确认/, { timeout: 150_000 });
  // 断口面：conv 流全程哑掉，方案卡仍须收敛上屏（修复前此处元素永缺席）。
  // 失败时先落四环证据再抛（m5 dumpSpineDiagnostics 同款判读：server 有没有
  // plan 行分岔「收敛断口」与「规划轮根本没产出」）。
  try {
    await pexpect(page.locator('.chat-plan-title').last()).toHaveText('方案 · v1', {
      timeout: 30_000,
    });
  } catch (err) {
    const todoNow = (await api(server.url, 'GET', `/api/todos/${todoId}`)).body as {
      latestBuildId: string | null;
    };
    const plansNow = todoNow.latestBuildId
      ? await api(server.url, 'GET', `/api/builds/${todoNow.latestBuildId}/plans`)
      : null;
    const tail = readFileSync(paths.daemonLog, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.includes('[skills] filtered:'))
      .slice(-12)
      .join('\n');
    console.error(
      [
        `\n===== #666 收敛诊断 =====`,
        `server 相位 = ${server.todoPhase(todoId)}`,
        `stub 收到 ${stub.requests.length} 次请求`,
        `plans 行 = ${plansNow ? JSON.stringify(plansNow.body).slice(0, 200) : '<无 build>'}`,
        `blocked(conv 流拦截次数) = ${blocked}`,
        `daemon 日志尾部:\n${tail}`,
        `===== 诊断结束 =====\n`,
      ].join('\n'),
    );
    throw err;
  }

  // 自证掐流面没有误伤 REST（失败方式 2）：plans 端点直查 200 + 恰一版。
  const todoRow = (await api(server.url, 'GET', `/api/todos/${todoId}`)).body as {
    latestBuildId: string | null;
  };
  expect(todoRow.latestBuildId).toBeTruthy();
  const plans = await api(server.url, 'GET', `/api/builds/${todoRow.latestBuildId}/plans`);
  expect(plans.status).toBe(200);
  expect(plans.body as unknown[]).toHaveLength(1);
  // 场景守恒（失败方式 3）：conv 流确实被拦过。
  expect(blocked).toBeGreaterThan(0);
});
