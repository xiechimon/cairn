#!/usr/bin/env node
// verify-cairn drive-mcp — MCP 页只读本地 config 面 probe(spec 13/#368)。
// 前置:launch.mjs 起栈时带 CAIRN_MCP_CONFIG=<fixture claude.json 路径>
// (env 经 launch 的 {...process.env} 透传给 server 进程);fixture 内容约定
// 见 features/mcp-servers.md(一个 http 条目带 headers + 一个 stdio 条目带
// env——密钥值只应出现在 config 文件,绝不上接口)。
// 真值三面:API JSON(config 投影 + 404 写面 + 无密钥值)、UI(行渲染 +
// 无新建/更多入口)、SQLite(mcp_server 表不存在)。
// #944 载体迁移:类名钩 → 语义/data-* 载体(.res-rowcard--mcp →
// [data-testid="resource-row"][data-mcp]、.res-empty → resource-empty
// testid、.res-row-title → 文案一级、.res-new → resource-new testid、
// .res-row-more 负向 → 行内 button 计数 0;断言语义不变)。
// 用法:node drive-mcp.mjs   (栈必须已在跑;证据目录同 drive.mjs 纪律)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const probe = 'mcp';
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

// fixture 期望面(与 features/mcp-servers.md 的配方一致;launch 前落盘)。
const EXPECT_SLUGS = ['demo', 'local'];
const SECRET_VALUES = ['v3r1fy-header-secret', 'v3r1fy-env-secret'];

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

try {
  // —— API 真值面 ————————————————————————————————————————————————
  const teams = await getJson(`${API}/api/teams`);
  const teamId = teams[0]?.id;
  check(typeof teamId === 'string' && teamId.length > 0, `GET /api/teams 拿到 teamId(${teamId})`);

  const rows = await getJson(`${API}/api/teams/${teamId}/mcp-servers`);
  extra.records = rows;
  const slugs = rows.map((r) => r.slug).sort();
  check(
    JSON.stringify(slugs) === JSON.stringify([...EXPECT_SLUGS].sort()),
    `GET mcp-servers = config 投影(${JSON.stringify(slugs)})`,
  );
  const demo = rows.find((r) => r.slug === 'demo');
  check(
    demo?.transport === 'http' &&
      demo?.hasCredential === true &&
      JSON.stringify(demo?.credentialKeys) === JSON.stringify(['Authorization']),
    `http 条目:transport/hasCredential/credentialKeys 键名投影(${JSON.stringify(demo)})`,
  );
  const local = rows.find((r) => r.slug === 'local');
  check(
    local?.transport === 'stdio' && local?.url === 'node' && local?.hasCredential === true,
    `stdio 条目:url 槽 = command 预览 + env 键名(${JSON.stringify(local)})`,
  );
  const raw = JSON.stringify(rows);
  check(
    SECRET_VALUES.every((v) => !raw.includes(v)),
    '安全不变量:env/headers 密钥值不出接口',
  );

  // 管理写面已删:POST/PATCH/DELETE = 404。
  for (const [method, path] of [
    ['POST', `/api/teams/${teamId}/mcp-servers`],
    ['PATCH', `/api/teams/${teamId}/mcp-servers/demo`],
    ['DELETE', `/api/teams/${teamId}/mcp-servers/demo`],
  ]) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify({ label: 'x', slug: 'x', transport: 'http', url: 'https://u' }) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    check(res.status === 404, `${method} ${path} = 404(管理写面已删,实测 ${res.status})`);
  }

  // —— SQLite 真值面:mcp_server 表不存在(migration drop)————————————
  const db = dbQuery((handle) => {
    const names = handle
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r) => r.name);
    return { hasMcpTable: names.includes('mcp_server') };
  });
  check(db.ok === true && db.hasMcpTable === false, `SQLite 无 mcp_server 表(${JSON.stringify(db)})`);

  // —— UI 面:live 渲染 + 只读钉扎 ————————————————————————————————
  await page.goto(`${WEB}/app/resources/mcp-servers`);
  await page.waitForSelector('[data-route="/app/resources/mcp-servers"]', { timeout: 15_000 });
  // live 数据 = react-query 异步到达——先行壳后行卡,等其一出现再断言。
  await page.waitForSelector('[data-testid="resource-row"][data-mcp], [data-testid="resource-empty"]', { timeout: 15_000 });
  const cards = page.locator('[data-testid="resource-row"][data-mcp]');
  const cardCount = await cards.count();
  check(cardCount === EXPECT_SLUGS.length, `页面渲染 ${cardCount} 行(期望 ${EXPECT_SLUGS.length})`);
  // #944 载体迁移:.res-row-title 类名钩 → 文案一级——行标题断言改按期望
  // slug 命中行内**精确文本节点**(getByText exact;节点级等值,强度不减)。
  const titles = [];
  for (const slug of EXPECT_SLUGS) {
    if ((await cards.getByText(slug, { exact: true }).count()) > 0) titles.push(slug);
  }
  extra.rowTitles = titles;
  check(titles.length === EXPECT_SLUGS.length, `行标题 = config 键名(${JSON.stringify(titles)})`);
  check((await page.locator('[data-testid="resource-new"]').count()) === 0, '无新建入口([data-testid="resource-new"] = 0)');
  check((await page.locator('[data-testid="resource-row"] button').count()) === 0, '行无更多菜单 ink([data-testid="resource-row"] button = 0)');
  await shot(page, '01-mcp-page-live.png');
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
