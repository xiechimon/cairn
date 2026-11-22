#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const probe = '5394-browsermcp';
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
const MCP_HREF = '/app/resources/mcp-servers';
const STORE_ID = 'bjfgambnhccakkhmkepdoekmckoijdlc';

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
const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
await page.addInitScript(() => {
  for (const key of ['cairn.locale', 'cairn-locale']) localStorage.setItem(key, 'zh');
});

try {
  const teams = await getJson(`${API}/api/teams`);
  const teamId = teams[0]?.id;
  check(typeof teamId === 'string' && teamId.length > 0, `GET /api/teams 拿到 teamId(${teamId})`);
  const path = `${API}/api/teams/${teamId}/mcp-connectors`;
  const before = await getJson(path);
  check(before.length === 0, `新栈没有连接器(${before.length})`);

  await page.goto(`${WEB}${MCP_HREF}`);
  await page.waitForSelector(`[data-route="${MCP_HREF}"]`, { timeout: 20_000 });
  const available = page.locator('[data-connector-card="Browser MCP"]');
  await available.waitFor({ timeout: 20_000 });
  check((await available.count()) === 1, '可接入里列出 Browser MCP 预设');
  check(
    (await available.innerText()).includes('在你自己的 Chrome'),
    '预设说明讲的是在用户自己的 Chrome 里干活',
  );
  await shot(page, '01-catalog-browsermcp.png');

  await page.getByRole('button', { name: '接入 Browser MCP' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10_000 });
  const install = dialog.locator(`a[href*="${STORE_ID}"]`);
  check((await install.count()) === 1, '弹窗给出去 Chrome 应用商店装扩展的链接');
  check(
    (await install.getAttribute('href'))?.startsWith('https://chromewebstore.google.com/') === true,
    '扩展链接指向应用商店',
  );
  const steps = dialog.locator('ol li');
  check((await steps.count()) === 2, `安装就两步(${await steps.count()})`);
  check(
    (await dialog.innerText()).includes('Allow'),
    '第二步写着第一次要在扩展弹窗里核对六位数字再点 Allow',
  );
  check(
    (await dialog.locator('input[type="password"]').count()) === 0,
    '这个预设不要令牌输入框',
  );
  await shot(page, '02-setup-dialog.png');

  await dialog.getByRole('button', { name: '启用' }).click();
  const connected = page.locator('[data-connector-card="Browser MCP"]');
  await page.waitForSelector('[data-testid="mcp-connected"] [data-connector-card="Browser MCP"]', {
    timeout: 15_000,
  });
  const rowText = await connected.innerText();
  check(rowText.includes('在你的 Chrome 里'), `接上后行内状态写"在你的 Chrome 里"(${rowText.replace(/\n/g, ' / ')})`);
  await shot(page, '03-connected-row.png');

  const records = await getJson(path);
  const record = records.find((r) => r.catalogId === 'browsermcp');
  extra.record = record;
  check(record?.transport === 'stdio', `记录 transport = stdio(${record?.transport})`);
  check(record?.status === 'local', `记录 status = local(${record?.status})`);
  check(record?.url === null, `记录没有 url(${JSON.stringify(record?.url)})`);
  check(record?.toolCount === null, '记录没有 toolCount(服务器不探它)');
  check(
    JSON.stringify(record?.headerNames) === '[]',
    `记录不带请求头(${JSON.stringify(record?.headerNames)})`,
  );
  check(!JSON.stringify(records).includes('-y @browsermcp/mcp'), '启动命令不上接口');

  const db = dbQuery((handle) => {
    const row = handle
      .prepare('SELECT transport, status, url, authKind FROM mcp_connector WHERE catalogId = ?')
      .get('browsermcp');
    return { row };
  });
  extra.db = db;
  check(
    db.ok === true &&
      db.row?.transport === 'stdio' &&
      db.row?.status === 'local' &&
      db.row?.url === null &&
      db.row?.authKind === 'none',
    `SQLite 行:stdio / local / url NULL / authKind none(${JSON.stringify(db.row)})`,
  );

  await page.getByRole('button', { name: '管理 Browser MCP' }).click();
  const manage = page.getByRole('dialog');
  await manage.waitFor({ timeout: 10_000 });
  const manageText = await manage.innerText();
  check(manageText.includes('在你的 Chrome 里'), '管理弹窗的状态同一句话');
  check((await manage.locator(`a[href*="${STORE_ID}"]`).count()) === 1, '管理弹窗也能再装一次扩展');
  check((await manage.locator('ol li').count()) === 2, '管理弹窗保留两步');
  check((await manage.locator('input').count()) === 0, '管理弹窗没有地址输入框');
  await shot(page, '04-manage-dialog.png');
} catch (err) {
  check(false, `probe 异常:${String(err?.message ?? err)}`);
  try {
    await shot(page, '99-error.png');
  } catch {}
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
