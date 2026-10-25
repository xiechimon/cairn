import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AGENT_ID, api, bootRealServer, type RealServer } from './helpers.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

let server: RealServer;
let browser: Browser;
let page: Page;
let todoId = '';

beforeAll(async () => {
  const build = spawnSync('pnpm', ['--filter', '@cairn/web', 'exec', 'vite', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`web build failed:\n${build.stdout}\n${build.stderr}`);
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error(`web dist missing at ${WEB_DIST}`);
  }
  server = await bootRealServer({
    providerBaseUrl: 'http://127.0.0.1:1',
    webDir: WEB_DIST,
  });
  const project = await api(server.url, 'POST', '/api/projects', {
    name: 'branch-dialog-it',
    teamId: server.teamId,
  });
  const projectId = (project.body as { id: string }).id;
  const todo = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
    title: '分支弹层接线探针',
    spec: '钉 #346：详情页分支弹层必须走 live 面',
  });
  todoId = (todo.body as { id: string }).id;
  const built = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: true,
  });
  expect(built.status).toBe(201);

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 }, locale: 'zh-CN' });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('branch-sync buildId wiring (#346 regression pin)', () => {
  test('detail right pane switches to the Branch & PR section → renders the live face (machine picker + editable dir), not the fixture placeholder', async () => {
    const todoFace = (await api(server.url, 'GET', `/api/todos/${todoId}`)).body as {
      latestBuildId: string | null;
    };
    expect(todoFace.latestBuildId).toBeTruthy();

    await page.goto(`${server.url}/app/todo/${todoId}`);
    const select = page.locator('.detail-right .doc-select-wrap .doc-pane-select');
    await pexpect(select).toBeVisible({ timeout: 30_000 });
    await select.click();
    await page.getByRole('menuitemradio', { name: '分支与 PR' }).click();

    const right = page.locator('.detail-right');
    const picker = right.getByRole('button', { name: '选择机器' });
    await pexpect(picker).toBeVisible({ timeout: 15_000 });
    const dirInput = page.getByLabel('同步目录');
    await pexpect(dirInput).toBeVisible();
    await pexpect(picker).toBeEnabled();
    await pexpect(right.getByRole('listbox')).toHaveCount(0);

    await pexpect(
      right.getByText(new RegExp(`conv-${todoFace.latestBuildId}$`)).first(),
    ).toBeVisible();

    await dirInput.fill('/tmp/branch-dialog-it-probe');
    await pexpect(dirInput).toHaveValue('/tmp/branch-dialog-it-probe');
  }, 180_000);
});
