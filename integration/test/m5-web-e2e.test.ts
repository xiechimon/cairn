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
let probeTodoId = '';
let probeConvId = '';

beforeAll(async () => {
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
        arguments: { command: `cat > plan.md <<'EOF'\n${PLAN_MD('spine')}\nEOF` },
      },
    },
    { content: '方案已就绪：Context / Changes / Edge cases / Verification 四段完整。' },
    {
      toolCall: { name: 'bash', arguments: { command: 'printf "m5 spine probe\\n" >> README.md' } },
    },
    { content: '修改已完成并验证通过：README.md 末行为 m5 spine probe。' },
    { content: '合并已确认：分支改动已并入默认分支。' },
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
          } catch {}
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return { types, stop: () => ctrl.abort() };
}

async function openBoard(): Promise<void> {
  await page.goto(`${server.url}/app`);
  await pexpect(
    page.getByRole('complementary').getByRole('button', { name: '新任务' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function createAndStart(title: string): Promise<void> {
  await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
  await pexpect(page.locator('.new-task-spec')).toBeVisible();
  await page.locator('.new-task-spec').fill(title);
  await page.locator('.new-task-dialog').getByRole('button', { name: '保存', exact: true }).click();
  await pexpect(page.getByRole('link', { name: title })).toBeVisible({
    timeout: 30_000,
  });
  const todos = (await api(server.url, 'GET', '/api/todos')).body as {
    id: string;
    title: string;
    projectId: string;
  }[];
  const created = todos.find((t) => t.title === title);
  if (!created) throw new Error(`createAndStart: todo not persisted (${title})`);
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

async function dumpSpineDiagnostics(label: string): Promise<void> {
  const out: string[] = [];
  try {
    const chip = await page.locator('.detail-chip').textContent({ timeout: 3_000 });
    out.push(`UI chip = ${JSON.stringify(chip)}`);
  } catch (err) {
    out.push(`UI chip unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    out.push(
      `server phase = ${probeTodoId ? server.todoPhase(probeTodoId) : '<todo id not recorded>'}`,
    );
  } catch (err) {
    out.push(`server phase unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    const reqs = stub?.requests ?? [];
    out.push(
      `stub received ${reqs.length} request(s); last = ${JSON.stringify(reqs[reqs.length - 1] ?? null).slice(0, 240)}`,
    );
  } catch (err) {
    out.push(`stub counter unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    if (probeConvId !== '') {
      const plans = server.db
        .select()
        .from(planTable)
        .where(eq(planTable.buildId, probeConvId))
        .all();
      out.push(
        `DB plans rows: ${plans.length}: ${plans
          .map((p) => `v${p.version}@${p.createdAt}(${String(p.content).slice(0, 40)}…)`)
          .join(' | ')}`,
      );
      const steps = server.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, probeConvId))
        .all();
      out.push(
        `DB steps rows: ${steps.length}: ${steps
          .map((s) => `${s.kind}/${s.status}@${s.createdAt}`)
          .join(' | ')}`,
      );
    }
  } catch (err) {
    out.push(`DB truth unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    const times = stub?.requestTimes ?? [];
    if (times.length > 0) {
      const t0 = times[0]!;
      out.push(`stub request times (ms since first): ${times.map((t) => t - t0).join(', ')}`);
    }
  } catch (err) {
    out.push(`stub timeline unreadable: ${String(err).slice(0, 120)}`);
  }
  try {
    const all = readFileSync(paths.daemonLog, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
    const real = all.filter((l) => !l.includes('[skills] filtered:'));
    const wake = all.filter((l) => l.includes('[wake]')).length;
    out.push(
      `daemon log ${all.length} lines ([skills] filtered omitted: ${all.length - real.length}); [wake] count: ${wake}`,
    );
    out.push(`daemon log tail (15 lines):\n${real.slice(-15).join('\n')}`);
  } catch (err) {
    out.push(`daemon log unreadable: ${String(err).slice(0, 120)}`);
  }
  console.error(
    `\n===== spine timeout diagnostics: ${label} =====\n${out.join('\n')}\n===== end diagnostics =====\n`,
  );
}

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

describe('M5 web E2E: main sequence full chain (01 §7.4 spine, zero UI reload)', () => {
  let buildId = '';
  let stream: { types: Set<string>; stop(): void };

  test('create → plan → confirm → build → review → merge → done (main-sequence spine)', async () => {
    await openBoard();
    await createAndStart('M5 脊柱探针');

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

    stream = collectConvStream(buildId);

    await openDetail('M5 脊柱探针');
    await waitChip(/确认/);
    await withDiagnostics('plan card v1 on screen', () =>
      pexpect(page.locator('.chat-plan-title').last()).toHaveText('方案 · v1', {
        timeout: 30_000,
      }),
    );
    await pexpect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v1/, {
      timeout: 30_000,
    });

    await page.locator('.detail-head-action').click();
    await waitChip(/审核/);

    expect(
      stream.types.has('text_delta'),
      `conv stream types: ${[...stream.types].join(',')}`,
    ).toBe(true);
    expect(stream.types.has('message')).toBe(true);
    expect(stream.types.has('step')).toBe(true);
    stream.stop();

    await page.locator('.detail-head-action').click();
    const accept = page.getByRole('dialog', { name: '完成任务' });
    await pexpect(accept.getByRole('button', { name: '完成' })).toBeVisible();
    await accept.getByRole('button', { name: '完成' }).click();
    await waitChip(/已完成/);

    await pexpect(page.locator('.chat-note', { hasText: '发起了合并' })).toBeVisible();
    await pexpect(page.locator('.chat-note', { hasText: '🎉 任务已完成' })).toBeVisible({
      timeout: 30_000,
    });

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

  test('reject branch: request changes at the confirm gate → replanning → plan v2 → confirm → review (r5 §4)', async () => {
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

    await page.locator('.composer-input').fill('标题去掉项目名后缀');
    await page.locator('.composer-send').click();

    await pexpect(page.locator('.chat-bubble', { hasText: '标题去掉项目名后缀' })).toBeVisible({
      timeout: 30_000,
    });
    await withDiagnostics('plan card v2 on screen', () =>
      pexpect(page.locator('.chat-plan-title').last()).toHaveText('方案 · v2', {
        timeout: 30_000,
      }),
    );
    await pexpect(page.locator('.doc-pane-select').nth(1)).toHaveText(/v2/, {
      timeout: 30_000,
    });

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

    await page.locator('.doc-range-wrap .doc-pane-select').click();
    await pexpect(page.locator('.version-menu-row')).toHaveCount(3, { timeout: 10_000 });
    await pexpect(page.locator('.version-menu-row').first()).toHaveText(/v2/);
    await page.getByRole('menuitem', { name: '与其他版本对比…' }).click();
    await page.getByRole('menuitem', { name: '上一版本' }).click();
    await pexpect(page.locator('.doc-range-chip')).toHaveText(/v1 → v2/);
    await pexpect(page.locator('.doc-file-row')).toHaveText(/plan\.md/);

    await page.locator('.detail-head-action').click();
    await waitChip(/审核/);
    expect(server.todoPhase(target!.id)).toBe('review');
  }, 300_000);

  test('scheduled run parks at review: create once schedule in UI → tick trigger → direct build → parks at review + started-by-schedule marker (r3 §9)', async () => {
    await page.goto(`${server.url}/app/schedules`);
    await page.getByRole('button', { name: '新建定时', exact: true }).click();
    await pexpect(page.getByRole('dialog', { name: '新建定时' })).toBeVisible();
    await page.getByRole('radio', { name: '单次' }).click();
    const next = new Date(Date.now() + 60_000);
    let minute = Math.ceil(next.getMinutes() / 15) * 15;
    let hour = next.getHours();
    if (minute === 60) {
      minute = 0;
      hour = (hour + 1) % 24;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    const pickSelect = async (slot: string, value: string) => {
      await page.locator(`button[aria-label="${slot}"]`).click();
      await page.getByRole('listbox').getByRole('option', { name: value, exact: true }).click();
    };
    await pickSelect('时', pad(hour));
    await pickSelect('分', pad(minute));
    await page.getByRole('button', { name: '保存' }).click();
    await pexpect(page.getByText('下次')).toBeVisible({ timeout: 15_000 });
    const schedules = (await api(server.url, 'GET', '/api/schedules')).body as {
      id: string;
      kind: string;
      nextRunAt: number | null;
    }[];
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.kind).toBe('once');

    const todosBefore = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      latestBuildId: string | null;
    }[];
    const spineBefore = todosBefore.find((t) => t.title === 'M5 脊柱探针');

    server.scheduler!.tick((schedules[0]!.nextRunAt ?? Date.now()) + 60_000);

    const spine = spineBefore;
    await withDiagnostics('scheduled run phase advances to review', () =>
      waitFor(() => server.todoPhase(spine!.id) === 'review', 150_000),
    );
    const after = (await api(server.url, 'GET', `/api/todos/${spine!.id}`)).body as {
      latestBuildId: string | null;
    };
    expect(after.latestBuildId).not.toBe(spineBefore!.latestBuildId);
    const schedBuild = (await api(server.url, 'GET', `/api/builds/${after.latestBuildId}`))
      .body as { triggerSource: string; withPlan: boolean };
    expect(schedBuild.triggerSource).toBe('schedule');
    expect(schedBuild.withPlan).toBe(false);
    expect((await api(server.url, 'GET', '/api/schedules')).body as unknown[]).toHaveLength(0);

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
