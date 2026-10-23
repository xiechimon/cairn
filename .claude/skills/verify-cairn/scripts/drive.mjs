#!/usr/bin/env node
// verify-cairn drive — 用仓库自带 @playwright/test 的 chromium 走真用户路径
// (live 面,URL 不带 ?scenario=)。栈必须已在跑(launch.mjs;坐标取
// VERIFY_RUN_DIR 下 ports.json,worktree 车道传 VERIFY_REPO_ROOT)。
// 用法:node drive.mjs <probe>   probe ∈ board | new-task | api-key | search | theme
// 证据(截图 + result.json)落 VERIFY_EVIDENCE_DIR(默认落**主仓**的
// .claude/verify-evidence/<时间戳>-<probe>/,与 VERIFY_REPO_ROOT 无关——
// lane 的栈在 worktree,证据落 worktree 会随它删除而丢失)。cleanup.mjs 不
// 删证据;证据交付见 SKILL.md「证据归档纪律」(在 PR 分支上 vp.mjs archive
// <票号> --from <证据目录> 拷进 docs/verify/<票号>/ 随 PR 提交,不手工 cp)。
// 任一断言失败退出码 1,
// result.json 里逐条记 checks。
// 口径与 apps/web/playwright.config.ts 一致:1440×732、colorScheme dark。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const PROBES = ['board', 'new-task', 'api-key', 'search', 'theme'];
const probe = process.argv[2];
if (!PROBES.includes(probe)) {
  console.error(`用法:node drive.mjs <probe>   probe ∈ ${PROBES.join(' | ')}`);
  process.exit(2);
}

const portsFile = join(RUN_DIR, 'ports.json');
let stack;
try {
  stack = JSON.parse(readFileSync(portsFile, 'utf8'));
} catch {
  console.error(`无栈:${portsFile} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-${probe}`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const artifacts = [];
const extra = {};
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  console.log(`shot  ${name}`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
};

/** SQLite 真值(只读)。better-sqlite3 在 apps/server 依赖里,按包定位解析。 */
const dbQuery = (fn) => {
  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, skipped: true, reason: String(err?.message ?? err) };
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

const gotoBoard = async () => {
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
};

try {
  if (probe === 'board') {
    await gotoBoard();
    // #351:看板更名「工作台」+ 6 列收敛为 4 列(单键折叠),列收起族删除,
    // 滚动器改 4 列均匀 grid(桌面无横向滚动,overflow-x 只作窄窗兜底)。
    const title = (await page.locator('.board-topbar-title').textContent())?.trim();
    check(title === '工作台', `顶栏标题 = 工作台(实测 ${title})`);

    const columns = await page.locator('.board-column').count();
    check(columns === 4, `工作台渲染 4 列(实测 ${columns})`);
    const seats = await page.locator('.board-column').evaluateAll((els) =>
      els.map((el) => [
        el.getAttribute('data-column'),
        el.querySelector('.board-column-name')?.textContent?.trim(),
      ]),
    );
    const canon = [
      ['todo', '待开始'],
      ['building', '执行中'],
      ['pending', '待处理'],
      ['done', '已完成'],
    ];
    check(
      JSON.stringify(seats) === JSON.stringify(canon),
      `列序 id↔名对拍(实测 ${seats.map(([id, name]) => `${id}:${name}`).join(' ')})`,
    );
    // 退役列名不再占列头(规划中 仍存活于详情 phase chip,本 probe 只看工作台面)
    const retired = await page
      .locator('.board-column-name')
      .evaluateAll((els) =>
        els.map((el) => el.textContent?.trim()).filter((n) => ['规划中', '待确认', '待验收'].includes(n)),
      );
    check(retired.length === 0, `退役列名不渲染(实测 ${retired.join('/') || '无'})`);

    // #147 列收起全家删除:钮/窄条/折叠态均无渲染位
    const collapse = await page
      .locator('.board-column-collapse, .board-column-strip, .board-column--collapsed')
      .count();
    check(collapse === 0, `列收起族已删除(实测 ${collapse} 个残留节点)`);

    // 均匀分布:4 列同轨宽 + 桌面无横向滚动,overflow-x 仍是窄窗兜底
    const widths = await page
      .locator('.board-column')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    const even = widths.length === 4 && widths.every((w) => Math.abs(w - widths[0]) <= 1);
    check(even && (widths[0] ?? 0) > 0, `4 列等宽(实测 ${widths.map((w) => Math.round(w)).join('/')})`);
    const scroller = await page.locator('.board-scroller').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth + 1,
      overflowX: getComputedStyle(el).overflowX,
    }));
    check(!scroller.scrollable, '桌面无横向滚动');
    check(scroller.overflowX === 'auto', `窄窗兜底 overflow-x = auto(实测 ${scroller.overflowX})`);

    // 待处理列空态 = Paper 列空态「暂无」(DESIGN.md 看板列;全新库全列空)
    const pendingEmpty = (
      await page.locator('[data-column="pending"] .board-column-empty').textContent()
    )?.trim();
    check(pendingEmpty === '暂无', `待处理空态文案(实测 ${pendingEmpty})`);

    const newBtn = page.locator('.sidebar-new-task');
    check(await newBtn.isVisible(), '侧栏「新任务」行可见');
    await shot(page, '01-board.png');
  }

  if (probe === 'new-task') {
    // 真用户路径:新建任务(全新库无项目 → 自动建「默认项目」再落任务)
    const title = `验证任务 ${Date.now() % 100000}`;
    await gotoBoard();
    await shot(page, '01-board-before.png');

    await page.click('.sidebar-new-task');
    await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
    check(true, '新建任务 dialog 打开');
    // spec 15 #394：单字段正文——标题输入位移除,占位标题 = 正文首行。
    await page.fill('.new-task-spec', title);
    await page.click('.new-task-save');
    await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });

    const card = page.locator('[data-column-list="todo"] .todo-card', { hasText: title });
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const seq = (
      await card.locator('.todo-card-meta').getByText(/^#\d+$/).first().textContent()
    )?.trim();
    check(seq?.startsWith('#') === true, `卡片落「待开始」列,序号 ${seq}`);
    await shot(page, '02-new-task-card.png');

    const todos = await getJson(`${API}/api/todos`);
    const apiTodo = Array.isArray(todos) ? todos.find((t) => t.title === title) : undefined;
    check(
      apiTodo != null && apiTodo.phase === 'todo',
      `GET /api/todos 含新任务(phase=${apiTodo?.phase ?? '缺失'})`,
    );
    extra.apiTodo = apiTodo ?? null;

    const dbTruth = dbQuery((db) => ({
      row: db
        .prepare('SELECT id, title, phase, seqNum FROM todo WHERE title = ?')
        .get(title),
    }));
    check(
      dbTruth.ok && dbTruth.row != null,
      `SQLite todo 表有行(seqNum=${dbTruth.row?.seqNum ?? '缺失'}${dbTruth.skipped ? `,跳过:${dbTruth.reason}` : ''})`,
    );
    extra.dbTodo = dbTruth.row ?? dbTruth.reason ?? null;
  }

  if (probe === 'api-key') {
    // 真用户路径:/app/api-keys 空态点「新建密钥」→ 一次性明文 + 掩码行。
    // 前提:全新库(重验先重跑 launch,按钮只在空态)。
    await page.goto(`${WEB}/app/api-keys`);
    // #1166 迁语义载体(spec 22 §5,#950/#910 后类名退役):空态 = keys-empty
    // testid、新建钮 = 空态 scope 的 role=button 文案一级;弹窗 = DialogShell
    // role=dialog(可及名 = title),提交钮 = 弹窗 scope 文案一级;一次性明文
    // = <code> 语义元素;掩码行 = Card 件 data-slot,一次块凭「仅显示一次」
    // 文案排除。
    const keysEmpty = page.getByTestId('keys-empty');
    await keysEmpty.waitFor({ timeout: 15_000 });
    check(true, 'API 密钥页空态就绪');
    await shot(page, '01-keys-empty.png');

    await keysEmpty.getByRole('button', { name: '新建密钥' }).click();
    // #287 起「新建密钥」走权限位表单弹窗(api-key-create-dialog.tsx):点
    // 「新建密钥」只开弹窗,须再点弹窗内「创建」提交,POST 成功响应回明文才
    // 渲染一次性明文块。表单默认值可直接提交(空名称 + 全不选,server
    // createApiKeyBodySchema 接受)。
    const createDialog = page.getByRole('dialog', { name: '新建密钥' });
    await createDialog.waitFor({ timeout: 15_000 });
    check(true, '新建密钥弹窗打开(#287 两步流)');
    await shot(page, '02-keys-create-dialog.png');
    await createDialog.getByRole('button', { name: '创建' }).click();
    const onceCode = page.locator('code', { hasText: 'cairn_' });
    await onceCode.waitFor({ timeout: 15_000 });
    const plaintext = (await onceCode.textContent())?.trim();
    check(
      plaintext?.startsWith('cairn_') === true,
      `一次性明文形态 cairn_…(${plaintext?.slice(0, 14)}…,仅显示一次)`,
    );
    // 掩码行的判别面:列表给明文条目也渲染一张无掩码的行卡,卡总数在
    // once 态 = 3(一次块 + 真掩码行 + once 空行)。真掩码行 = 文本含
    // cairn_ 且无 <code> 子孙(一次块是唯一带 code 的卡)。
    const maskedRows = await page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'cairn_' })
      .filter({ hasNot: page.locator('code') })
      .count();
    check(maskedRows === 1, `密钥列表出现掩码行(${maskedRows} 行)`);
    await shot(page, '03-keys-once.png');

    const teams = await getJson(`${API}/api/teams`);
    const teamId = teams[0]?.id;
    const keys = await getJson(`${API}/api/teams/${teamId}/api-keys`);
    const masked = Array.isArray(keys) ? keys[0]?.masked : undefined;
    check(masked?.startsWith('cairn_') === true, `API 掩码行(${masked ?? '缺失'})`);
    extra.apiKeyMasked = masked ?? null;

    const dbTruth = dbQuery((db) => ({
      row: db.prepare('SELECT id, name, masked, keyHash FROM api_key').get(),
    }));
    check(
      dbTruth.ok && dbTruth.row?.keyHash != null,
      `SQLite api_key 表存 keyHash 非明文(02 §8 护栏)`,
    );
    extra.dbApiKey = dbTruth.row ?? dbTruth.reason ?? null;
  }

  if (probe === 'search') {
    // 铺底(公开 REST,非被测路径)→ 真用户路径:⌘K 开面板 → 输入 → 命中。
    // ⌘K 配方照抄 e2e search-focus.spec.ts:热键监听注册在被动 effect,首按
    // 可能早于 hydration,丢键就重按(面板可见即停,不会双 toggle);折叠/
    // 展开两种侧栏态都覆盖(展开态无 .rail-row,别用侧栏行当唯一入口)。
    const title = `搜索目标 ${Date.now() % 100000}`;
    const proj = await postJson(`${API}/api/projects`, {
      name: '搜索验证',
      repoKind: 'hosted',
    });
    await postJson(`${API}/api/projects/${proj.id}/todos`, { title, spec: title });
    await gotoBoard();

    // #1166 迁语义载体(spec 22 §5,#949/#910 裁定后类名退役,与
    // e2e search-focus.spec.ts 同律):面板 = role dialog + 可及名「搜索」,
    // 输入 = 面板 scope 的 textbox,结果行 = data-row-kind="todo"。
    const panel = page.getByRole('dialog', { name: '搜索' });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.keyboard.press('Meta+k');
      const opened = await panel
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
      if (attempt === 5) throw new Error('⌘K 未打开搜索面板(6 次重按后)');
    }
    check(true, '搜索面板打开(⌘K)');
    await panel.getByRole('textbox').fill(title);
    const row = page
      .getByRole('dialog', { name: '搜索' })
      .locator('[data-row-kind="todo"]', { hasText: title });
    await row.first().waitFor({ state: 'visible', timeout: 10_000 });
    check(true, `结果行命中「${title}」`);
    await shot(page, '02-search-results.png');
    extra.searchTarget = title;
  }

  if (probe === 'theme') {
    // live 面用户菜单 popover 暂无触发器(fixture-only,见 features/theme.md
    // gotcha);live 可验的持久化路径 = cairn-theme localStorage 键(与
    // e2e addInitScript 同键,apps/web/src/theme.ts)。
    await gotoBoard();
    await shot(page, '01-theme-default-dark.png');

    await page.evaluate(() => localStorage.setItem('cairn-theme', 'light'));
    await page.reload();
    await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
    const light = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      light: document.documentElement.classList.contains('light'),
    }));
    check(
      light.theme === 'light' && light.light === true,
      `light 生效(${JSON.stringify(light)})`,
    );
    await shot(page, '02-theme-light.png');

    await page.evaluate(() => localStorage.setItem('cairn-theme', 'dark'));
    await page.reload();
    await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
    const dark = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      light: document.documentElement.classList.contains('light'),
    }));
    check(
      dark.theme === 'dark' && dark.light === false,
      `dark 生效(${JSON.stringify(dark)})`,
    );
    await shot(page, '03-theme-dark.png');
  }
} catch (err) {
  check(false, `probe 异常:${String(err?.message ?? err)}`);
  try {
    await shot(page, '99-error.png');
  } catch {
    /* 截不上就算了 */
  }
} finally {
  await browser.close();
}

const ok = failures === 0;
const result = {
  probe,
  ok,
  at: now.toISOString(),
  stack: { api: API, web: WEB, homeDir: stack.homeDir, root: stack.root },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

console.log(ok ? `drive ${probe}:PASS` : `drive ${probe}:FAIL(${failures} 项)`);
console.log(`evidence:${EVIDENCE}`);
process.exit(ok ? 0 : 1);
