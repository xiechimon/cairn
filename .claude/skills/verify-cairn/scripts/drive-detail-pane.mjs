#!/usr/bin/env node
// verify-cairn drive-detail-pane — 详情页 3-pane 结构 + 右 pane 视图切换
// (#366)。live 面(URL 不带 ?scenario=),栈必须已在跑(launch.mjs)。
//
// 自含现场:API 建 provider/agent/project/todo(不起 daemon——结构验证不需要
// 步执行)→ fresh 面验左中贴合/右栏不渲染(XMON-55 P0 #563:无线程态整栏
// 让给中心列)/头部单图标 → POST build → thread 面验三栏几何 + 右 pane
// 四视图(文档/分支与 PR/Token 用量/运行历史)全程无模态。
//
// 判别式(与 integration/test/m7-branch-dialog-e2e.test.ts 同款):分支 section
// live 面 = `.dlg-machine-picker` + `.dlg-dir--input`;buildId 漏传则落回
// fixture 占位(`.dlg-machine[disabled]` + `.dlg-dir` div),必红。
//
// 用法:node drive-detail-pane.mjs
// 证据(截图 + result.json)落 VERIFY_EVIDENCE_DIR(默认脚本所在仓的
// .claude/verify-evidence/<时间戳>-detail-pane/)。任一断言失败退出码 1。
// 口径与 apps/web/playwright.config.ts 一致:1440×732、colorScheme dark。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-detail-pane`);
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
  if (!res.ok && res.status !== 409) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
};

const dbQuery = (fn) => {
  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } catch (err) {
      return { ok: false, skipped: true, reason: String(err?.message ?? err) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, skipped: true, reason: String(err?.message ?? err) };
  }
};

// —— 现场 seed(API 直建,不起 daemon)———————————————————————————————
const teams = await getJson(`${API}/api/teams`);
const teamId = teams[0].id;
await postJson(`${API}/api/teams/${teamId}/providers`, {
  providerId: 'stub-gw',
  label: 'Stub Gateway',
  baseUrl: 'http://127.0.0.1:9/v1',
  api: 'openai-completions',
  authHeader: true,
  compat: { supportsDeveloperRole: false },
  models: [{ id: 'stub-model', name: 'stub-model' }],
}).catch(() => {}); // 409 = 已存在
const agent = await postJson(`${API}/api/teams/${teamId}/agents`, {
  displayName: 'detail-pane-probe',
  provider: 'stub-gw',
  modelId: 'stub-model',
});
const agentId = agent.id ?? agent.agentId ?? agent.record?.id;
const project = await postJson(`${API}/api/projects`, { name: '详情 pane 探针', teamId });
const projectId = project.id ?? project.record?.id;
const todo = await postJson(`${API}/api/projects/${projectId}/todos`, {
  title: '详情 pane 结构探针',
  spec: '#366 三栏几何 + 右 pane 视图切换',
});
const todoId = todo.id ?? todo.record?.id;
extra.todoId = todoId;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {
  // —— 1. fresh 面:左中贴合 + 右栏不渲染 + 头部单图标 ——————————————
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.detail-fresh', { timeout: 15_000 });
  const geo = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    };
    return {
      sidebar: rect('.board-sidebar'),
      center: rect('.detail-center'),
      right: rect('.detail-right'),
    };
  });
  check(geo.sidebar?.width === 240, `左栏 240(实测 ${geo.sidebar?.width})`);
  check(geo.right == null, `fresh 面右栏整栏不渲染(XMON-55 P0;实测 ${geo.right?.width ?? '无'})`);
  check(
    geo.center != null && geo.sidebar != null && geo.center.left === geo.sidebar.right,
    '中栏与左栏贴合(无隙无叠)',
  );
  check(
    (await page.locator('.detail-tabs-group, .detail-tab').count()) === 0,
    '文档|聊天 tab 组不存在',
  );
  check(
    (await page.locator('.detail-center .fresh-block').count()) === 1,
    'fresh block 落中心列',
  );
  const headIcons = await page.evaluate(() =>
    [...document.querySelectorAll('.detail-head button[aria-label]')].map((b) =>
      b.getAttribute('aria-label'),
    ),
  );
  check(
    headIcons.includes('更多') &&
      !headIcons.includes('分支与 PR') &&
      !headIcons.includes('Token 用量') &&
      !headIcons.includes('运行历史'),
    `头部只留 更多 单图标(实测 [${headIcons.join(', ')}])`,
  );
  await shot(page, '01-fresh-3pane.png');

  // —— 2. 起 build → thread 面:右 pane 文档视图 + 型选 listbox ——————————
  await postJson(`${API}/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  }).catch(() => {}); // 响应体形状不依赖——buildId 以 todo 读面为真值
  const afterBuild = await getJson(`${API}/api/todos/${todoId}`);
  const buildId = afterBuild.latestBuildId ?? null;
  extra.buildId = buildId;
  check(buildId != null, `build 已起(latestBuildId=${buildId ?? '缺失'})`);

  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.detail-right .doc-pane', { timeout: 15_000 });
  check(true, 'thread 面右 pane 默认文档视图(DocPane 在位)');
  // 三栏几何在 thread 面钉(fresh 面无右栏,见 XMON-55 P0)。
  const threadGeo = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    };
    return { center: rect('.detail-center'), right: rect('.detail-right') };
  });
  check(threadGeo.right?.width === 488, `右 pane 488(实测 ${threadGeo.right?.width})`);
  check(
    threadGeo.center != null &&
      threadGeo.right != null &&
      threadGeo.right.left === threadGeo.center.right,
    '右 pane 与中栏贴合(hairline 缝)',
  );
  await shot(page, '02-thread-doc.png');

  await page.click('.detail-right .doc-select-wrap .doc-pane-select');
  // #949/#910 载体：.plan-dropdown/.plan-dropdown-row 类钉已随 overlays.css 清零
  // 退役 → role=menu / menuitemradio（本脚本 #951 维护轮补迁）。
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  const rows = await page.locator('[role="menuitemradio"]').count();
  check(rows === 4, `型选 listbox 4 行(文档 + 三 section;实测 ${rows})`);
  await shot(page, '03-pane-dropdown.png');

  // —— 3. 分支与 PR section:live 判别式(机器 picker + 可编辑目录)—————
  await page.locator('[role="menuitemradio"]', { hasText: '分支与 PR' }).click();
  // #951/#910 载体：.dlg-machine-picker/.dlg-dir--input/.dlg-machine[disabled]/
  // .dlg-branch-value 类钩退役 → aria-haspopup 钮 + getByLabel(同步目录) +
  // 互斥分支判别（picker 在场即占位缺席，同一 ternary）+ 结构位取分支值。
  await page.waitForSelector('.detail-right button[aria-haspopup="listbox"]', { timeout: 15_000 });
  check(
    (await page.locator('.detail-right').getByLabel('同步目录').count()) === 1 &&
      (await page.locator('.detail-right button[aria-haspopup="listbox"]').count()) === 1,
    '分支 section 走 live 面(buildId 接线在位,非 fixture 占位)',
  );
  check((await page.locator('[role="dialog"]').count()) === 0, '分支面为静止 section,无模态弹层');
  const branchValue = await page
    .locator('.detail-right .pane-section-body > div > div:nth-of-type(1) > div:nth-child(1) > span:nth-child(2)')
    .first()
    .textContent();
  check(
    buildId != null && (branchValue ?? '').endsWith(`conv-${buildId}`),
    `分支名与 buildId 同源(${branchValue})`,
  );
  await shot(page, '04-branch-section.png');

  // —— 4. Token 用量 / 运行历史 section + 切回文档 ————————————————
  await page.click('.detail-right .doc-select-wrap .doc-pane-select');
  await page.locator('[role="menuitemradio"]', { hasText: 'Token 用量' }).click();
  await page.locator('.detail-right').getByText('tokens', { exact: true }).waitFor({ timeout: 5000 });
  check(true, 'Token 用量 section 静止渲染');
  await shot(page, '05-token-section.png');

  await page.click('.detail-right .doc-select-wrap .doc-pane-select');
  await page.locator('[role="menuitemradio"]', { hasText: '运行历史' }).click();
  await page.waitForSelector('.detail-right [data-testid="history-row"]', { timeout: 5000 });
  const historyRows = await page.locator('.detail-right [data-testid="history-row"]').count();
  check(historyRows >= 1, `运行历史 section 行渲染(${historyRows} 行)`);
  await shot(page, '06-history-section.png');

  await page.click('.detail-right .doc-select-wrap .doc-pane-select');
  await page.locator('[role="menuitemradio"]').first().click();
  await page.waitForSelector('.detail-right .doc-pane', { timeout: 5000 });
  check(true, '文档行切回 DocPane 视图');

  // —— 5. 双真值:API + SQLite ————————————————————————————————————
  const buildFace = await getJson(`${API}/api/builds/${buildId}`);
  check(
    buildFace.id === buildId && buildFace.todoId === todoId,
    `API 真值:GET /api/builds/{id} 命中且挂本 todo(${buildFace.id})`,
  );
  const db = dbQuery((d) => ({
    todoRow: d.prepare('SELECT id, phase FROM todo WHERE id = ?').get(todoId),
    buildRow: d.prepare('SELECT id FROM build WHERE id = ?').get(buildId),
  }));
  check(
    db.ok !== false && db.todoRow?.id === todoId && db.buildRow?.id === buildId,
    `SQLite 真值:todo 行(phase=${db.todoRow?.phase})+ build 行在库`,
  );
} catch (err) {
  check(false, `探针异常:${String(err?.message ?? err)}`);
  await shot(page, 'error-state.png').catch(() => {});
} finally {
  await browser.close();
}

const result = {
  probe: 'detail-pane',
  ticket: 366,
  at: new Date().toISOString(),
  stack: { api: API, web: WEB, runDir: RUN_DIR },
  checks,
  artifacts,
  extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`evidence:${EVIDENCE}`);
process.exit(failures > 0 ? 1 : 0);
