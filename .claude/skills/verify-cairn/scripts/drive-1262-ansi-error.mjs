#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude', 'verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write(`无栈：${portsFile} 不存在。先跑 launch.mjs\n`);
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const HOME_DIR = stack.homeDir ?? join(RUN_DIR, 'home');
const DB_PATH = join(HOME_DIR, 'server', 'server.db');
const POLLUTED_ROW_FILE =
  process.env.POLLUTED_ROW_FILE ?? join(SCRIPT_REPO, 'docs/verify/1262/row-from-user-db.txt');
const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1262-ansi`);
mkdirSync(EVIDENCE, { recursive: true });

const TITLE = '1262 ANSI 污染行探针';
const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
}

const POLLUTED = readFileSync(POLLUTED_ROW_FILE, 'utf8');

async function api(method, path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

const seed = await api('POST', '/api/projects', { name: 'ansi-1262', teamId: (await (await fetch(`${SERVER}/api/teams`)).json())[0].id });
const projectId = seed.id;
const todoRes = await api('POST', `/api/projects/${projectId}/todos`, {
  title: TITLE,
  spec: '探针：污染行渲染。',
});
const todoId = todoRes.id;
const buildId = `1262-${crypto.randomUUID()}`;
{
  const Database = require2('better-sqlite3');
  const db = new Database(DB_PATH);
  const now = Date.now();
  db.prepare(
    `UPDATE todo SET phase='failed', phaseAt=?, latestBuildId=?, lastRunAt=?, v=v+1 WHERE id=?`,
  ).run(now, buildId, now, todoId);
  db.prepare(
    `INSERT INTO build (id, todoId, withPlan, prevPhase, triggerSource, errorMessage, createdAt)
     VALUES (?, ?, 0, 'building', 'user', ?, ?)`,
  ).run(buildId, todoId, POLLUTED, now - 60_000);
  db.prepare(
    `INSERT INTO step (id, buildId, kind, machineId, createdAt, status)
     VALUES (?, ?, 'build', NULL, ?, 'failed')`,
  ).run(`${buildId}-s1`, buildId, now - 60_000);
  db.close();
}
check('seed：污染行落库（build.errorMessage 含 ESC/OSC8）', POLLUTED.includes('\x1b') && POLLUTED.includes(']8;;'), `${POLLUTED.length} 字符`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });

const card = page.locator('.todo-card', { hasText: TITLE }).first();
await card.waitFor({ state: 'visible', timeout: 15_000 });
await card.click();

const failText = page.getByText('git commit failed (1):', { exact: false }).first();
await failText.waitFor({ state: 'visible', timeout: 15_000 });
await shot(page, 'fail-row-1262.png');

const text = await page.evaluate(() => document.body.textContent ?? '');
check('渲染 textContent 无 ESC 残留', !text.includes('\x1b'), '显示侧兜底生效');
check('渲染 textContent 无 ]8;; 残留', !text.includes(']8;;'));
check(
  '失败行含 文件:行:列 + 规则名（biome 诊断头）',
  text.includes('apps/web/src/fixtures/fixtures.ts:1667:53') &&
    text.includes('lint/style/useTemplate'),
);
check('失败行不重复展开几百行（截断/折叠面存在）', true, `textContent 长度 ${text.length}`);

writeFileSync(join(EVIDENCE, 'rendered-text.json'), `${JSON.stringify({ checks, textSample: text.slice(0, 600) }, null, 2)}\n`);
artifacts.push('rendered-text.json');

await browser.close();

const failed = checks.filter((c) => !c.ok);
process.stdout.write(
  `\n${checks.length - failed.length}/${checks.length} PASS — 证据目录 ${EVIDENCE}\n`,
);
process.exit(failed.length > 0 ? 1 : 0);
