// M5 端到端主时序全链实跑（#83 票面 / 01 §7.4 脊柱 / 04 §4 M5 行）：
// 真 web 生产构建（server 同源静态托管，02/A1）+ 真 server + 真 daemon
// （pi 缝）+ stub LLM，Playwright 驱动 UI 走完整生命周期：
//   ① 主时序：新建（web 保存 + API 起 build，#640 注）→ 规划（live
//      transcript）→ 确认 → 执行 → 审核 → 验收合并（202 delegated）→ done
//      （🎉 时间线 + main 落地真值）。#640：「保存并开始」入口已改直发总管
//      编排回合，脊柱改走 API 起 build 以保确定性（见 createAndStart 注）；
//      编排入口覆盖归 server orchestration-source 测 + live verify-cairn。
//   ② 驳回支线：confirm 关口 composer 发送 feedback → 服务端重规划（DB 修订步
//      为证，#880：亚秒 planning 瞬态不做 chip oracle）→ plan v2 → 版本 chip
//      v2 → 确认 → 执行 → 审核（r5 §4 回路 UI 实走）。
//   ③ 定时轮停 review：UI 建 once 定时 → scheduler.tick 触发 → 直执行新
//      build → 停审核关口 + 「由定时发起」时间线标记（r3 §9/02 §9.2）。
// SSE 断言：build 会话流并行采集 text_delta/message/step 三类事件（02 §1.2
// 会话流真接线）；UI 全程零 reload——状态推进全部由 SSE→invalidate 驱动。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { plan as planTable, step as stepTable } from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, waitFor } from './helpers.js';
import { type StubLlm, startStubLlm } from './stub-llm.js';

// integration/test/<file> → repo root = 三级上跳（resolve 对文件路径先剥
// 文件名段）。
const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

const PLAN_MD = (marker: string) =>
  [
    '# 方案',
    '',
    `Context: ${marker} 探针任务。`,
    'Changes: 在 README.md 追加一行探针。',
    'Edge cases: 无。',
    'Verification: 读回 README.md 确认。',
  ].join('\n');

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let browser: Browser;
let page: Page;
// 诊断用：当前被观察的 todo id（每个用例找到自己的票据后写入），超时诊断据此
// 报 server 侧相位——UI 说「规划中」，server 是否也停在原地，是分叉判读的关键。
let probeTodoId = '';
// 诊断用：当前被观察的 build id（conv），超时诊断据此报 DB 真值（plans/steps
// 行 + 相对时刻）——#698 判因：UI 停住时「plan 行落库没有」与「行在但 UI 没刷」
// 的分叉只能靠 DB 真值钉死。
let probeConvId = '';

beforeAll(async () => {
  // web 生产构建（scenario-blind = 恒 live 数据源，#58 gate）。
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
    // —— ① 主时序：plan（toolCall+text）→ build（toolCall+text）→ merge（text）
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD('spine')}\nEOF` },
      },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "m5 spine probe\\n" >> README.md' } },
    },
    { content: '修改已完成并验证通过：README.md 末行为 m5 spine probe。' },
    { content: '合并已确认：分支改动已并入默认分支。' },
    // —— ② 驳回支线：plan → 重规划 v2（内容带 feedback 标记）→ build
    {
      toolCall: {
        name: 'bash',
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD('reject-v1')}\nEOF` },
      },
    },
    { content: '方案 v1 已就绪。' },
    {
      toolCall: {
        name: 'bash',
        arguments: {
          command: `cat > plan.md <<'EOF'\n${PLAN_MD('标题去掉项目名后缀-adjusted')}\nEOF`,
        },
      },
    },
    { content: '已按驳回反馈调整方案：标题去掉项目名后缀。' },
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m5 reject probe\\n" >> README.md' },
      },
    },
    { content: '驳回轮修改已完成。' },
    // —— ③ 定时轮：直执行（无规划步）
    {
      toolCall: {
        name: 'bash',
        arguments: { command: 'printf "m5 schedule probe\\n" >> README.md' },
      },
    },
    { content: '定时轮修改已完成，等待审核。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试执行 Agent：按任务要求用 bash 工具完成文件改动，然后简短汇报。',
    webDir: WEB_DIST,
    scheduler: true,
  });
  home = mkdtempSync(join(tmpdir(), 'cairn-m5web-home-'));
  const config = loadDaemonConfig(
    { serverUrl: server.url, apiKey: server.apiKey, teamId: server.teamId, home, name: 'm5-web' },
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
  page = await browser.newPage({ viewport: { width: 1440, height: 732 }, locale: 'zh-CN' });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  if (home) rmSync(home, { recursive: true, force: true });
});

/** 会话流事件采集器（node 侧 fetch reader——与 web EventSource 同通道同
 * 载荷）：返回已见事件 type 集与 stop 句柄。 */
function collectConvStream(buildId: string): { types: Set<string>; stop(): void } {
  const types = new Set<string>();
  const ctrl = new AbortController();
  void (async () => {
    const res = await fetch(`${server.url}/api/conversations/${buildId}/stream`, {
      signal: ctrl.signal,
    });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            types.add((JSON.parse(line.slice(5).trim()) as { type: string }).type);
          } catch {
            // 半帧防御
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return { types, stop: () => ctrl.abort() };
}

async function openBoard(): Promise<void> {
  await page.goto(`${server.url}/app`);
  // #445：顶栏「+ 任务」撤除——就绪探针与创建入口改指侧栏「新任务」行。
  // #943/#910：类名钉换一级 role+name 载体（integration 面同律）。
  await pexpect(
    page.getByRole('complementary').getByRole('button', { name: '新任务' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function createAndStart(title: string): Promise<void> {
  await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
  // spec 15 #394：单字段正文——title 参数即正文首行，占位标题 = 首行原文。
  await pexpect(page.locator('.new-task-spec')).toBeVisible();
  await page.locator('.new-task-spec').fill(title);
  // #640：「保存并开始」已改直发总管编排回合（chief round → run_builds），不再
  // 是 withPlan:true 直建 build。本脊柱测的是 plan→confirm→build→review→merge
  // 生命周期（入口非脊柱本体）；而 chief 回合的 run_builds 会挂 watch，在
  // confirm/review/done 关口触发 wake 轮，打乱顺序 stub 队列的消费序（m4a 因此
  // 只用读侧工具，同一纪律）。故此处用 web「保存」落卡 + API startBuilds
  // （withPlan:true）直起 build，保住脊柱的确定性。「保存并开始 → 编排」入口
  // 的覆盖归 server orchestration-source 测（D 组）+ live verify-cairn。
  await page.locator('.new-task-dialog').getByRole('button', { name: '保存', exact: true }).click();
  // 卡落板（SSE/invalidate 驱动，无 reload）。
  await pexpect(page.getByRole('link', { name: title })).toBeVisible({
    timeout: 30_000,
  });
  // API 直起 withPlan:true build（脊柱走 plan/confirm 关口；triggerSource user）。
  const todos = (await api(server.url, 'GET', '/api/todos')).body as {
    id: string;
    title: string;
    projectId: string;
  }[];
  const created = todos.find((t) => t.title === title);
  if (!created) throw new Error(`createAndStart: todo 未落库（${title}）`);
  const started = await api(server.url, 'POST', `/api/projects/${created.projectId}/builds`, {
    todoIds: [created.id],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: true,
  });
  if (started.status !== 201) throw new Error(`createAndStart: startBuilds ${started.status}`);
}

async function openDetail(title: string): Promise<void> {
  await page.getByRole('link', { name: title }).click();
  await pexpect(page.locator('.detail-shell')).toBeVisible({ timeout: 15_000 });
}

/**
 * 超时诊断（2026-09-30 加）：这条脊柱在 CI 上曾连红数十次（同 sha 连跑同点同败、
 * 纯文档提交也红），而失败信息只有「chip 还是规划中」——UI 停住了，但不知道卡在
 * 哪一环。超时那一刻把四环证据打进日志，判读口径：
 *   server 相位也停在原位  → 相位推进根本没发生（daemon 侧问题）
 *   server 已推进而 UI 没动 → SSE → invalidate → refetch 这一链断了
 *   stub 零请求            → daemon 没认领（wake/claim 路径）
 * 只加证据、不改断言。
 */
async function dumpSpineDiagnostics(label: string): Promise<void> {
  const out: string[] = [];
  try {
    const chip = await page.locator('.detail-chip').textContent({ timeout: 3_000 });
    out.push(`UI chip = ${JSON.stringify(chip)}`);
  } catch (err) {
    out.push(`UI chip 读不到: ${String(err).slice(0, 120)}`);
  }
  try {
    out.push(`server 相位 = ${probeTodoId ? server.todoPhase(probeTodoId) : '<未记录 todo id>'}`);
  } catch (err) {
    out.push(`server 相位读不到: ${String(err).slice(0, 120)}`);
  }
  try {
    const reqs = stub?.requests ?? [];
    out.push(
      `stub 收到 ${reqs.length} 次请求；最后一次 = ${JSON.stringify(reqs[reqs.length - 1] ?? null).slice(0, 240)}`,
    );
  } catch (err) {
    out.push(`stub 计数读不到: ${String(err).slice(0, 120)}`);
  }
  // #698 证据面：DB 真值 + 事件时间线。plans/steps 行的落库与否与相对时刻，
  // 把「UI 停住」分叉成「行没落库」（daemon/upload 面）与「行在但 UI 没刷」
  // （SSE/invalidate 面）；stub 请求时间线给步内轮次节奏（零调用 no-op 与
  // 正常两轮在计数上不可分时，时刻差仍可分）。
  try {
    if (probeConvId !== '') {
      const plans = server.db
        .select()
        .from(planTable)
        .where(eq(planTable.buildId, probeConvId))
        .all();
      out.push(
        `DB plans 行 ${plans.length} 条: ${plans
          .map((p) => `v${p.version}@${p.createdAt}(${String(p.content).slice(0, 40)}…)`)
          .join(' | ')}`,
      );
      const steps = server.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, probeConvId))
        .all();
      out.push(
        `DB steps 行 ${steps.length} 条: ${steps
          .map((s) => `${s.kind}/${s.status}@${s.createdAt}`)
          .join(' | ')}`,
      );
    }
  } catch (err) {
    out.push(`DB 真值读不到: ${String(err).slice(0, 120)}`);
  }
  try {
    const times = stub?.requestTimes ?? [];
    if (times.length > 0) {
      const t0 = times[0]!;
      out.push(`stub 请求时刻（相对首条，ms）: ${times.map((t) => t - t0).join(', ')}`);
    }
  } catch (err) {
    out.push(`stub 时间线读不到: ${String(err).slice(0, 120)}`);
  }
  try {
    const all = readFileSync(paths.daemonLog, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    // [skills] filtered 每轮几十行声明式噪音，会把尾部真正要看的事件挤掉
    const real = all.filter((l) => !l.includes('[skills] filtered:'));
    const wake = all.filter((l) => l.includes('[wake]')).length;
    out.push(
      `daemon 日志 ${all.length} 行（略去 [skills] filtered ${all.length - real.length} 行）；[wake] ${wake} 条`,
    );
    out.push(`daemon 日志尾部 15 行:\n${real.slice(-15).join('\n')}`);
  } catch (err) {
    out.push(`daemon 日志读不到: ${String(err).slice(0, 120)}`);
  }
  console.error(`\n===== 脊柱超时诊断：${label} =====\n${out.join('\n')}\n===== 诊断结束 =====\n`);
}

/** 断言包一层诊断：失败时先落证据再抛原错。 */
async function withDiagnostics<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await dumpSpineDiagnostics(label);
    throw err;
  }
}

async function waitChip(re: RegExp, timeoutMs = 150_000): Promise<void> {
  await withDiagnostics(`waitChip(${String(re)})`, () =>
    pexpect(page.locator('.detail-chip')).toHaveText(re, { timeout: timeoutMs }),
  );
}

describe('M5 web E2E：主时序全链（01 §7.4 脊柱，UI 零 reload）', () => {
  let buildId = '';
  let stream: { types: Set<string>; stop(): void };

  test('新建 → 规划 → 确认 → 执行 → 审核 → 合并 → done（主时序脊柱）', async () => {
    await openBoard();
    await createAndStart('M5 脊柱探针');

    // server 真值：todo 落库 + build 启动（withPlan）。
    const todos = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const spine = todos.find((t) => t.title === 'M5 脊柱探针');
    expect(spine).toBeTruthy();
    probeTodoId = spine!.id;
    buildId = spine!.latestBuildId!;
    probeConvId = buildId;
    expect(buildId).toBeTruthy();

    // 会话流采集挂在 build 会话上（SSE 真接线断言面）。
    stream = collectConvStream(buildId);

    await openDetail('M5 脊柱探针');
    // 规划轮：live 面到 confirm 关口（plan.md v1 落库由 daemon 真执行）。
    await waitChip(/确认/);
    // plan 卡进时间线（方案 · v1）+ 文档 pane 版本 chip v1。两处与 chip 翻相
    // 不同链（transcript/文档面走会话 SSE→invalidate→refetch，负载下可落后
    // 相位 chip 数秒）——显式 30s 预算对齐本文件其他跨进程断言（PR #239 CI
    // red 复盘：5s 默认档在 ubuntu runner 上偶发不够，元素迟到 ≠ 缺席）。
    await withDiagnostics('plan 卡 v1 上屏', () =>
      pexpect(page.locator('.chat-plan-title').last()).toHaveText('方案 · v1', {
        timeout: 30_000,
      }),
    );
    await pexpect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v1/, {
      timeout: 30_000,
    });

    // 确认 → 执行轮（continue session + bash 真改动）→ 审核关口。
    await page.locator('.detail-head-action').click();
    await waitChip(/审核/);

    // 执行轮的会话流三事件族齐证（text_delta = daemon 节流转发真到达）。
    expect(
      stream.types.has('text_delta'),
      `conv stream types: ${[...stream.types].join(',')}`,
    ).toBe(true);
    expect(stream.types.has('message')).toBe(true);
    expect(stream.types.has('step')).toBe(true);
    stream.stop();

    // 审核 → 验收弹层 → 完成（merge 202 delegated → 合并步 → done）。
    await page.locator('.detail-head-action').click();
    // #951/#910 重钉：.dlg-accept-done → dialog scope getByRole(button 完成)
    // （accept 弹层可及名「完成任务」；detail-head-action 是 #945 留存别名钩，
    // 终账 #952/#953）。
    const accept = page.getByRole('dialog', { name: '完成任务' });
    await pexpect(accept.getByRole('button', { name: '完成' })).toBeVisible();
    await accept.getByRole('button', { name: '完成' }).click();
    await waitChip(/已完成/);

    // 时间线 canon：发起了合并 + 🎉（server 落库行经 SSE→invalidate 上屏）。
    await pexpect(page.locator('.chat-note', { hasText: '发起了合并' })).toBeVisible();
    await pexpect(page.locator('.chat-note', { hasText: '🎉 任务已完成' })).toBeVisible({
      timeout: 30_000,
    });

    // server 真值：main 落地探针行（合并步 fast-forward，r3 §3.6 同款验证）。
    const projects = (await api(server.url, 'GET', '/api/projects')).body as {
      id: string;
      name: string;
    }[];
    const projectId = projects[0]!.id;
    await waitFor(async () => {
      const f = await api(
        server.url,
        'GET',
        `/api/projects/${projectId}/file?path=README.md&ref=main`,
      );
      return f.status === 200 && (f.body as { content: string }).content.includes('m5 spine probe');
    }, 30_000);
    expect(server.todoPhase(spine!.id)).toBe('done');
  }, 300_000);

  test('驳回支线：confirm 关口请求修改 → 规划中 → plan v2 → 确认 → 审核（r5 §4）', async () => {
    await openBoard();
    await createAndStart('M5 驳回探针');
    const todos = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const target = todos.find((t) => t.title === 'M5 驳回探针');
    probeTodoId = target!.id;
    const rejectBuildId = target!.latestBuildId!;
    probeConvId = rejectBuildId;

    await openDetail('M5 驳回探针');
    await waitChip(/确认/);

    // composer 发送驳回反馈 = POST steps {action:"revision"}（真端点）。
    await page.locator('.composer-input').fill('标题去掉项目名后缀');
    // 真实 click：#347 修复后发送钮不再被总管 FAB 遮挡（遮挡回归时这里超时）。
    await page.locator('.composer-send').click();

    // #880：「规划中」不做 UI oracle。相位 chip 是采样面（S8 canon：SSE 事件只是
    // 失效提示，chip 文案 = todo 查询快照的 PHASE_UI 映射），而 stub 下修订步
    // 创建 → v2 落库的 planning 窗口实测仅 175~375ms（2026-10-05 三份 CI dump，
    // docs/verify/880/）；2vCPU 负载下 SSE→invalidate→refetch 往返恒超窗，每次
    // 采样都在相位翻回 confirm 之后构建，chip 从未渲染过「规划中」——150s×303
    // 次轮询全见「确认」（#717 判因同源：亚秒瞬态在采样式架构下不可观察，
    // #767「留待裁决 1」选项 a）。改钉持久证据：驳回气泡（发送即落库）→
    // plan 卡 v2 → 版本 chip v2；「相位确实重入规划」由下方 DB 修订步断言钉住
    // （服务端真值，不依赖瞬态渲染）。30s 预算 = 本文件跨进程断言统一口径。
    await pexpect(page.locator('.chat-bubble', { hasText: '标题去掉项目名后缀' })).toBeVisible({
      timeout: 30_000,
    });
    await withDiagnostics('plan 卡 v2 上屏', () =>
      pexpect(page.locator('.chat-plan-title').last()).toHaveText('方案 · v2', {
        timeout: 30_000,
      }),
    );
    await pexpect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v2/, {
      timeout: 30_000,
    });

    // server 真值：plan 两版，v2 内容忠实执行反馈（r5 §4 口径）；第二个 plan
    // 步（修订步）= 相位重入规划过的持久证据（#880，替代瞬态 chip oracle）。
    const plans = server.db
      .select()
      .from(planTable)
      .where(eq(planTable.buildId, rejectBuildId))
      .all();
    expect(plans).toHaveLength(2);
    expect(plans[1]!.version).toBe(2);
    expect(plans[1]!.content).toContain('标题去掉项目名后缀-adjusted');
    const rejectSteps = server.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, rejectBuildId))
      .all();
    expect(rejectSteps.filter((s) => s.kind === 'plan')).toHaveLength(2);

    // 版本对比面：下拉 → 与其他版本对比 → 上一版本 = v1 → v2 unified diff。
    // 行集 = v2 + v1 + 对比入口行（reject-chain spec 同款计数口径）。
    // #1006 载体迁移（#986 C 层：断言语义不动，与 reject-chain.spec 同步）：
    // 版本菜单从手搓 Button 行迁 registry DropdownMenu 原语，行载体
    // button → menuitem（#910 裁定 1 一级）。
    await page.locator('.doc-range-wrap .doc-pane-select').click();
    await pexpect(page.locator('.version-menu-row')).toHaveCount(3, { timeout: 10_000 });
    await pexpect(page.locator('.version-menu-row').first()).toHaveText(/v2/);
    await page.getByRole('menuitem', { name: '与其他版本对比…' }).click();
    await page.getByRole('menuitem', { name: '上一版本' }).click();
    await pexpect(page.locator('.doc-range-chip')).toHaveText(/v1 → v2/);
    await pexpect(page.locator('.doc-file-row')).toHaveText(/plan\.md/);

    // 确认 → 执行 → 审核（支线终点：停审核关口，不合并）。
    await page.locator('.detail-head-action').click();
    await waitChip(/审核/);
    expect(server.todoPhase(target!.id)).toBe('review');
  }, 300_000);

  test('定时轮停 review：UI 建 once 定时 → tick 触发 → 直执行 → 停审核 + 由定时发起（r3 §9）', async () => {
    // UI 建定时：schedules 页 → 新建 → 单次 tab → 下一刻钟档（02 §9.2 分档
    // 00/15/30/45）→ 保存。#946/#910 载体：顶栏动作/弹层/频率 tab/保存走
    // role+文案语义位（类名别名退役面）。
    await page.goto(`${server.url}/app/schedules`);
    await page.getByRole('button', { name: '新建定时', exact: true }).click();
    await pexpect(page.getByRole('dialog', { name: '新建定时' })).toBeVisible();
    // 频率分段 = SegmentedRadio（选一个存下来的值）：载体 role=radio（集成层
    // 同 PR 迁移，#735 教训）。
    await page.getByRole('radio', { name: '单次' }).click();
    const next = new Date(Date.now() + 60_000);
    let minute = Math.ceil(next.getMinutes() / 15) * 15;
    let hour = next.getHours();
    if (minute === 60) {
      minute = 0;
      hour = (hour + 1) % 24;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    // XMON-75 → #1010：时 / 分从原生 <select>（XMON-75 前）到手写 select.tsx
    // （XMON-75，role=listbox/aria-label 同挂一个 div）再到 registry compound
    // select（#1010 回源，Base UI）。原生 select 形态在界面里已清零。
    // #1010 钩子迁移（#735 教训：跨层语义钩子随格式变更同 PR 迁移 integration
    // 读面）：Base UI 把 role=listbox 放在内层 Select.List 上，而 registry
    // SelectContent 的 aria-label 落在 role=presentation 的外层 Popup（实测
    // listbox 的 aria-label 恒 null）——旧 `[role=listbox][aria-label=slot]`
    // 复合钩子在 pristine 件下不可达，除非偏离上游（违 ADR 0012 D1）。触发钮
    // 仍带 aria-label=slot（= 可及名 + aria-controls 指向 listbox）。关闭的弹层
    // 会滞留 DOM 但 display:none（实测：offsetParent=null、0×0），被 Playwright
    // 的 getByRole 排除在可及树外——故 `getByRole('listbox')` 恒命中唯一可见
    // 弹层，即便 时(00–23) 与 分(00/15/30/45) 共享值 '00' 也不撞 strict mode
    // （滞留的 时 '00' 不在可及树）。行按值取，选择即关面，两槽各开一次。
    const pickSelect = async (slot: string, value: string) => {
      await page.locator(`button[aria-label="${slot}"]`).click();
      await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
    };
    await pickSelect('时', pad(hour));
    await pickSelect('分', pad(minute));
    await page.getByRole('button', { name: '保存' }).click();
    // 卡落列表（invalidate 重取）：卡面一级 text 载体（下次运行行）。
    await pexpect(page.getByText('下次')).toBeVisible({ timeout: 15_000 });
    const schedules = (await api(server.url, 'GET', '/api/schedules')).body as {
      id: string;
      kind: string;
      nextRunAt: number | null;
    }[];
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.kind).toBe('once');

    // 触发前的 build 位（= 主时序已合并轮）——触发后必须换新 build（r3 §9
    // 全新重跑语义）。
    const todosBefore = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const spineBefore = todosBefore.find((t) => t.title === 'M5 脊柱探针');

    // 触发：手动 tick 越过 nextRunAt（scheduler 确定性驱动，同 schedules
    // 单测口径）。once 触发后自动出队（r3 §9）。
    server.scheduler!.tick((schedules[0]!.nextRunAt ?? Date.now()) + 60_000);

    // 直执行轮（withPlan:false + triggerSource schedule）→ 停 review 关口。
    const spine = spineBefore;
    await withDiagnostics('定时轮相位推进到 review', () =>
      waitFor(() => server.todoPhase(spine!.id) === 'review', 150_000),
    );
    const after = (await api(server.url, 'GET', `/api/todos/${spine!.id}`)).body as {
      latestBuildId: string | null;
    };
    expect(after.latestBuildId).not.toBe(spineBefore!.latestBuildId); // 新 build 全新重跑
    const schedBuild = (await api(server.url, 'GET', `/api/builds/${after.latestBuildId}`))
      .body as { triggerSource: string; withPlan: boolean };
    expect(schedBuild.triggerSource).toBe('schedule');
    expect(schedBuild.withPlan).toBe(false);
    // once 出队。
    expect((await api(server.url, 'GET', '/api/schedules')).body as unknown[]).toHaveLength(0);

    // UI 面：看板卡回 待处理 列（#351：review 并入待处理）+ 详情时间线
    // 「由定时发起」标记（r7 38）。
    await openBoard();
    const reviewCol = page.getByRole('region', { name: '待处理' });
    await pexpect(reviewCol.locator('[data-todo-id]', { hasText: 'M5 脊柱探针' })).toBeVisible({
      timeout: 15_000,
    });
    await openDetail('M5 脊柱探针');
    await pexpect(page.locator('.chat-scheduled')).toBeVisible({ timeout: 15_000 });
    await waitChip(/审核/);
  }, 300_000);
});
