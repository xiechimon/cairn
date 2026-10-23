#!/usr/bin/env node
// verify-cairn drive-avatars — dicebear Lorelei 头像系统（#387）live 全链验证。
//
// 真用户路径：看板侧栏头像 chip → user-menu 头部 → 团队页连建两个不同名
// Agent（创建 dialog 头像行随名称输入即时预览 dicebear 种子）→ 卡片网格两像
// 不同。live 面数据全真（members POST/GET、SQLite agent 表），dicebear 出站
// 请求由 page.route 拦截回固定 SVG——探针钉的是 src 契约 + 真服务端数据，
// 外网可达性不进断言（离线兜底 = onError 回退静态资产，由 e2e
// avatar-dicebear.spec.ts 钉）。
//
// 真值：GET /api/user/me（displayName=Owner, avatarUrl=null）/ GET members
// （agent actor.avatarUrl=null =  dicebear 生成语义保留）/ SQLite agent 行
// avatarUrl IS NULL / 拦截器实测到 dicebear 请求（证明 URL 真被构造发出）。
// 用法：node drive-avatars.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-avatars`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {
  // 断言位必须真是 boolean（drive-tags 同款护栏）——写反会恒真。
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};

const dbQuery = (fn) => {
  try {
    const Database = require2('better-sqlite3');
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

const DICEBEAR_PREFIX = 'https://api.dicebear.com/9.x/lorelei/svg?seed=';
const dicebearUrl = (seed) => `${DICEBEAR_PREFIX}${encodeURIComponent(seed)}`;
// 侧栏/user-menu 是 fixture canon chrome（USER_NAME 常量，live 不变）——种子
// 即展示名，两态一致。
const USER_SEED = 'Xmon Dai';
const stamp = Date.now() % 100000;
const AGENT_A = `验证头像-${stamp}`; // 非 ASCII 种子,顺带钉 encodeURIComponent 路径
const AGENT_B = `avatar-probe-b-${stamp}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

// dicebear 拦截:回固定 SVG(两色区分 user/agent 请求无意义,统一即可),
// 记录命中 URL——命中即证明浏览器真的按 src 发出了请求。
const dicebearHits = [];
await page.route('**/api.dicebear.com/**', (route) => {
  dicebearHits.push(route.request().url());
  return route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="11" fill="#6366f1"/></svg>',
  });
});

const imgSrc = (locator) => locator.getAttribute('src', { timeout: 5000 });

try {
  // —— 看板:侧栏 chip + user-menu 头部 ————————————————————————————————
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  const chipSrc = await imgSrc(page.locator('.sidebar-user img'));
  check(
    'sidebar-chip-seeded',
    chipSrc === dicebearUrl(USER_SEED),
    `侧栏 chip src=${chipSrc ?? '无 img'}`,
  );
  await page.click('.sidebar-user');
  await page.waitForSelector('.user-menu-head img', { timeout: 5000 });
  const menuSrc = await imgSrc(page.locator('.user-menu-head img'));
  check('user-menu-same-src', menuSrc === chipSrc, 'user-menu 头部与 chip 同像(同名恒同)');
  await shot(page, '01-sidebar-user-menu.png');
  await page.keyboard.press('Escape');

  // —— 团队页:创建 dialog 预览 + 双 Agent 网格 ————————————————————————
  await page.goto(`${WEB}/app/team`);
  await page.waitForSelector('.team-create-agent', { timeout: 15_000 });
  await page.click('.team-create-agent');
  // #951/#910 载体：.dlg-agent-avatar 类钩退役 → agent-avatar testid（img 在
  // loaded 前 aria-hidden，role 钉不到——二级载体）。
  await page.waitForSelector('[data-testid="agent-avatar"] img', { timeout: 5000 });
  const emptySrc = await imgSrc(page.locator('[data-testid="agent-avatar"] img'));
  check(
    'dialog-empty-fallback',
    emptySrc === '/avatar-robot-1.svg',
    `空名预览 = 静态资产(src=${emptySrc ?? '无'})`,
  );
  await page.fill('#dlg-agent-name', AGENT_A);
  await page.waitForFunction(
    (prefix) => document.querySelector('[data-testid="agent-avatar"] img')?.getAttribute('src')?.startsWith(prefix),
    DICEBEAR_PREFIX,
    { timeout: 5000 },
  );
  const previewSrc = await imgSrc(page.locator('[data-testid="agent-avatar"] img'));
  check(
    'dialog-live-preview',
    previewSrc === dicebearUrl(AGENT_A),
    `输入即时预览种子(src=${previewSrc ?? '无'})`,
  );
  await shot(page, '02-create-dialog-preview.png');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 });

  // 第二个不同名 Agent
  await page.click('.team-create-agent');
  await page.waitForSelector('#dlg-agent-name', { timeout: 5000 });
  await page.fill('#dlg-agent-name', AGENT_B);
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 });

  await page.waitForFunction(
    (name) => [...document.querySelectorAll('.team-agent-name')].some((el) => el.textContent === name),
    AGENT_B,
    { timeout: 10_000 },
  );
  const cardSrc = async (name) => {
    const card = page.locator('.team-agent-card', { hasText: name });
    return imgSrc(card.locator('.team-agent-avatar img'));
  };
  const srcA = await cardSrc(AGENT_A);
  const srcB = await cardSrc(AGENT_B);
  check('agent-card-a-seeded', srcA === dicebearUrl(AGENT_A), `卡 A src=${srcA ?? '无'}`);
  check('agent-card-b-seeded', srcB === dicebearUrl(AGENT_B), `卡 B src=${srcB ?? '无'}`);
  check('distinct-names-distinct-srcs', srcA != null && srcB != null && srcA !== srcB, '不同名不同像');
  await shot(page, '03-team-two-agents.png');

  // —— 真值:API + SQLite + dicebear 请求命中 ————————————————————————————
  const me = await getJson(`${SERVER}/api/user/me`);
  check(
    'api-user-me',
    me?.displayName === 'Owner' && me?.avatarUrl === null,
    `seed 用户 displayName=${me?.displayName ?? '?'} avatarUrl=${JSON.stringify(me?.avatarUrl)}`,
  );
  const teams = await getJson(`${SERVER}/api/teams`);
  const teamId = Array.isArray(teams) ? teams[0]?.id : undefined;
  const members = teamId ? await getJson(`${SERVER}/api/teams/${teamId}/members`) : [];
  const actorOf = (name) =>
    Array.isArray(members)
      ? members.find((m) => m.memberType === 'agent' && m.actor?.displayName === name)?.actor
      : undefined;
  const actorA = actorOf(AGENT_A);
  const actorB = actorOf(AGENT_B);
  check(
    'api-members-avatarurl-null',
    actorA != null && actorA.avatarUrl === null && actorB != null && actorB.avatarUrl === null,
    'members actor.avatarUrl=null(dicebear 语义保留)',
  );
  const dbTruth = dbQuery((db) => ({
    a: db.prepare('SELECT displayName, avatarUrl FROM agent WHERE displayName = ?').get(AGENT_A),
    b: db.prepare('SELECT displayName, avatarUrl FROM agent WHERE displayName = ?').get(AGENT_B),
  }));
  check(
    'db-agent-avatarurl-null',
    dbTruth.a != null && dbTruth.a.avatarUrl === null && dbTruth.b != null && dbTruth.b.avatarUrl === null,
    `SQLite agent 行 avatarUrl IS NULL(A=${dbTruth.a ? '有' : '无'}/B=${dbTruth.b ? '有' : '无'})`,
  );
  const seededHits = dicebearHits.filter((u) => u.startsWith(DICEBEAR_PREFIX));
  check(
    'dicebear-requests-fired',
    seededHits.length >= 4,
    `浏览器实发 dicebear 请求 ${seededHits.length} 次(chip/menu/预览/双卡)`,
  );
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'avatars',
  issue: 387,
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  agentA: AGENT_A,
  agentB: AGENT_B,
  dicebearHits: dicebearHits.length,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive avatars:PASS' : 'drive avatars:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
