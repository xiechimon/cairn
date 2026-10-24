#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { spiralAvatarUrl } from '../../../../apps/web/src/lib/spiral-avatar.ts';

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
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) needs a boolean ok, got ${typeof ok}`);
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

const SPIRAL_PREFIX = 'data:image/svg+xml,';
const USER_SEED = 'Xmon Dai';
const stamp = Date.now() % 100000;
const AGENT_A = `验证头像-${stamp}`;
const AGENT_B = `avatar-probe-b-${stamp}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

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
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  const chipSrc = await imgSrc(page.locator('.sidebar-user img'));
  check(
    'sidebar-chip-seeded',
    chipSrc === spiralAvatarUrl(USER_SEED),
    `sidebar chip src=${chipSrc ?? 'no img'}`,
  );
  await page.click('.sidebar-user');
  await page.waitForSelector('.user-menu-head img', { timeout: 5000 });
  const menuSrc = await imgSrc(page.locator('.user-menu-head img'));
  check('user-menu-same-src', menuSrc === chipSrc, 'user-menu head matches the chip (same name, same image)');
  await shot(page, '01-sidebar-user-menu.png');
  await page.keyboard.press('Escape');

  await page.goto(`${WEB}/app/team`);
  await page.waitForSelector('.team-create-agent', { timeout: 15_000 });
  await page.click('.team-create-agent');
  await page.waitForSelector('[data-testid="agent-avatar"] img', { timeout: 5000 });
  const emptySrc = await imgSrc(page.locator('[data-testid="agent-avatar"] img'));
  check(
    'dialog-empty-fallback',
    emptySrc === '/avatar-robot-1.svg',
    `empty-name preview = static asset (src=${emptySrc ?? 'none'})`,
  );
  await page.fill('#dlg-agent-name', AGENT_A);
  await page.waitForFunction(
    (prefix) => document.querySelector('[data-testid="agent-avatar"] img')?.getAttribute('src')?.startsWith(prefix),
    SPIRAL_PREFIX,
    { timeout: 5000 },
  );
  const previewSrc = await imgSrc(page.locator('[data-testid="agent-avatar"] img'));
  check(
    'dialog-live-preview',
    previewSrc === spiralAvatarUrl(AGENT_A),
    `live preview follows the typed seed (src=${previewSrc ?? 'none'})`,
  );
  await shot(page, '02-create-dialog-preview.png');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 });

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
  check('agent-card-a-seeded', srcA === spiralAvatarUrl(AGENT_A), `card A src=${srcA ?? 'none'}`);
  check('agent-card-b-seeded', srcB === spiralAvatarUrl(AGENT_B), `card B src=${srcB ?? 'none'}`);
  check('distinct-names-distinct-srcs', srcA != null && srcB != null && srcA !== srcB, 'different names, different images');
  await shot(page, '03-team-two-agents.png');

  const me = await getJson(`${SERVER}/api/user/me`);
  check(
    'api-user-me',
    me?.displayName === 'Owner' && me?.avatarUrl === null,
    `seed user displayName=${me?.displayName ?? '?'} avatarUrl=${JSON.stringify(me?.avatarUrl)}`,
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
    'members actor.avatarUrl=null (local-generation semantics preserved)',
  );
  const dbTruth = dbQuery((db) => ({
    a: db.prepare('SELECT displayName, avatarUrl FROM agent WHERE displayName = ?').get(AGENT_A),
    b: db.prepare('SELECT displayName, avatarUrl FROM agent WHERE displayName = ?').get(AGENT_B),
  }));
  check(
    'db-agent-avatarurl-null',
    dbTruth.a != null && dbTruth.a.avatarUrl === null && dbTruth.b != null && dbTruth.b.avatarUrl === null,
    `SQLite agent row avatarUrl IS NULL (A=${dbTruth.a ? 'present' : 'missing'}/B=${dbTruth.b ? 'present' : 'missing'})`,
  );
  check(
    'no-dicebear-requests',
    dicebearHits.length === 0,
    `browser issued ${dicebearHits.length} dicebear requests (must be 0)`,
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
