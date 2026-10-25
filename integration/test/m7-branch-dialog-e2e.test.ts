// 分支同步面 live 接线回归钉（#346，钉住 #319 的 buildId 传参；#366 起详情
// 页入口 = 右 pane 型选 →「分支与 PR」静止 section，判别式不变）。
//
// 为什么单独钉这一条：分支同步面的 `buildId` 是 prop-only（`buildIdProp ??
// null`），只有 teamId 从 useLiveData 派生。两个调用点（todo-detail-page 的
// RightPane BranchSection / board-page 的 BranchDialog）一旦漏传，
// `canSync = buildId !== null && live` 恒 false —— 同步面会永远停在 r7
// fixture 占位（机器 pill 不可点、目录只读、同步钮 disabled），而**界面上没有
// 任何报错**，极难发现。#346 实测踩过：当时全仓引用 branch-sync 的测试只有
// server 的 wire.test.ts，CI 全绿而功能不可达。
//
// 判别式（live vs fixture 占位，两处互斥分支）：
//   live    → 机器 picker 钮（可及名「选择机器」，零在线机器时）在场且可点
//             + 目录是可填 input（aria-label「同步目录」）
//   fixture → disabled 占位钮 + 目录是只读 div
// 所以「同步目录 input 在场」即等价于「调用点传了 buildId」。
// #951/#910 重钉：.dlg-machine-picker/.dlg-machine[disabled]/.dlg-dir--input/
// .dlg-machine-menu/.dlg-branch-value 类名钩随 detail/overlays.css 清零退役
// ——载体换 role+可及名（picker 与占位钮是同一 ternary 的互斥分支，
// 「picker 可点」即「占位缺席」）、getByLabel（目录 input 补 aria-label）、
// role=listbox（菜单缺席）与分支名文案一级。
//
// 本用例不覆盖真同步执行（需 daemon 在线机器）——那一面由 verify-cairn 的
// `drive-branch-sync.mjs` 探针真栈跑（配方与验证状态见
// .claude/skills/verify-cairn/features/branch-sync.md）。

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
    // 本用例不跑 agent 步：provider 指向不监听地址即可。
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
  // 起 build → 让 todo.latestBuildId 非空（详情页据此把 buildId 传给弹层）。
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

describe('分支同步面 buildId 接线（#346 回归钉）', () => {
  test('详情页右 pane 切「分支与 PR」section → 渲染 live 面（机器 picker + 可编辑目录），非 fixture 占位', async () => {
    // 前置真值：todo 带上了 latestBuildId——没有它 buildId 恒 null，本用例的
    // 判别式就失去意义（先钉住前置，避免 setup 漂移被误读成产品回归）。
    const todoFace = (await api(server.url, 'GET', `/api/todos/${todoId}`)).body as {
      latestBuildId: string | null;
    };
    expect(todoFace.latestBuildId).toBeTruthy();

    await page.goto(`${server.url}/app/todo/${todoId}`);
    // #366：头部「分支与 PR」图标弹层退役——入口 = 右 pane 型选钮开 pane
    // 视图 listbox，行点击切静止 section。
    const select = page.locator('.detail-right .doc-select-wrap .doc-pane-select');
    await pexpect(select).toBeVisible({ timeout: 30_000 });
    await select.click();
    // #949 载体：盘行 = menuitemradio + 文案（.plan-dropdown-row 类钉退役）
    await page.getByRole('menuitemradio', { name: '分支与 PR' }).click();

    // 判别式：live 面 = 机器 picker + 可编辑目录输入（section 内）。
    const right = page.locator('.detail-right');
    const picker = right.getByRole('button', { name: '选择机器' });
    await pexpect(picker).toBeVisible({ timeout: 15_000 });
    const dirInput = page.getByLabel('同步目录');
    await pexpect(dirInput).toBeVisible();
    // fixture 占位面（buildId 漏传时的落点）特征不得出现：占位钮与 picker
    // 是同一 ternary 的互斥分支，picker 可点（非 disabled 占位）即占位缺席。
    await pexpect(picker).toBeEnabled();
    await pexpect(right.getByRole('listbox')).toHaveCount(0); // 未展开时菜单不开

    // 背景信息：section 头部渲染的分支名由 buildId 推出（brand.conversationBranch）
    // ——与 live 面同源，可交叉印证 buildId 确实非空（文案一级载体）。
    await pexpect(
      right.getByText(new RegExp(`conv-${todoFace.latestBuildId}$`)).first(),
    ).toBeVisible();

    // 同步目录是可编辑 input：填一个值应能落住（fixture 面是只读 div，填不进去）。
    await dirInput.fill('/tmp/branch-dialog-it-probe');
    await pexpect(dirInput).toHaveValue('/tmp/branch-dialog-it-probe');
  }, 180_000);
});
