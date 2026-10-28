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
  'Kind: fix',
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

test('plan card converges via the team-stream phase event when the conv stream is dead (#666)', async () => {
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

  let blocked = 0;
  await page.route('**/api/conversations/*/stream', (route) => {
    blocked += 1;
    void route.abort();
  });

  await page.goto(`${server.url}/app/todo/${todoId}`);
  await pexpect(page.locator('.detail-shell')).toBeVisible({ timeout: 30_000 });
  await pexpect(page.locator('.detail-chip')).toHaveText(/确认/, { timeout: 150_000 });
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
        `\n===== #666 convergence diagnostics =====`,
        `server phase = ${server.todoPhase(todoId)}`,
        `stub received ${stub.requests.length} request(s)`,
        `plans rows = ${plansNow ? JSON.stringify(plansNow.body).slice(0, 200) : '<no build>'}`,
        `blocked (conv stream intercepts) = ${blocked}`,
        `daemon log tail:\n${tail}`,
        `===== end diagnostics =====\n`,
      ].join('\n'),
    );
    throw err;
  }

  const todoRow = (await api(server.url, 'GET', `/api/todos/${todoId}`)).body as {
    latestBuildId: string | null;
  };
  expect(todoRow.latestBuildId).toBeTruthy();
  const plans = await api(server.url, 'GET', `/api/builds/${todoRow.latestBuildId}/plans`);
  expect(plans.status).toBe(200);
  expect(plans.body as unknown[]).toHaveLength(1);
  expect(blocked).toBeGreaterThan(0);
});
