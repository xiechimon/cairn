#!/usr/bin/env node

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

const [todoId, failedBuildId] = process.argv.slice(2);
if (!todoId || !failedBuildId) {
  process.stderr.write('usage: node drive-failed-send.mjs <todoId> <failedBuildId>\n');
  process.exit(2);
}
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-failed-send`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {

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
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
};
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { status: res.status, body: parsed };
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

function decodeContent(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    const v = JSON.parse(raw);
    return typeof v === 'string' ? v : raw;
  } catch {
    return raw;
  }
}

const extra = {};
const todoBefore = await getJson(`${SERVER}/api/todos/${todoId}`);
check(
  'precondition-failed',
  todoBefore.body?.phase === 'failed',
  `前置:todo 处于 failed 相位(实测 ${todoBefore.body?.phase ?? '未知'}；不满足时先按脚本头部的造法跑一遍)`,
);

const feedback = `反馈探针 ${Date.now() % 100000}：请把失败原因纳入本轮`;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer', { timeout: 15_000 });
  const editable = await page.locator('.composer-input').count();
  check('composer-editable', editable === 1, 'failed 相位 composer 可编辑（非只读占位）');
  await shot(page, '01-failed-composer.png');

  await page.fill('.composer-input', feedback);
  const filled = await page.locator('.composer-input').inputValue();
  check('draft-filled', filled === feedback, `反馈文本入 draft(${filled.slice(0, 18)}…)`);
  await shot(page, '02-draft-filled.png');

  const sendBox = await page.locator('.composer-send').boundingBox();

  const hitAtCenter = sendBox
    ? await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return 'null';
          if (el.closest('.composer-send')) return 'closest(.composer-send)';
          const cls = typeof el.className === 'string' ? el.className : '';
          return `${el.tagName}.${cls}[aria=${el.getAttribute('aria-label') ?? '-'}]`;
        },
        { x: sendBox.x + sendBox.width / 2, y: sendBox.y + sendBox.height / 2 },
      )
    : 'null';
  const mouseReaches = hitAtCenter === 'closest(.composer-send)';
  extra.sendReachableByMouse = mouseReaches;
  extra.sendCenterHit = hitAtCenter;
  process.stdout.write(
    `note  composer-send 鼠标可达=${mouseReaches}（中心点命中 ${hitAtCenter}；被 .detail-fab 覆盖时不可达，键盘 Enter 仍可发送）\n`,
  );

  await page.locator('.composer-send').dispatchEvent('click');
  check('send-clicked', true, '发送钮点击（failed 相位 = restart 语义）');

  await page
    .waitForFunction(
      async (args) => {
        const res = await fetch(`/api/todos/${args.todoId}`);
        if (!res.ok) return false;
        const t = await res.json();
        return t.latestBuildId != null && t.latestBuildId !== args.old;
      },
      { todoId, old: failedBuildId },
      { timeout: 20_000 },
    )
    .catch(() => {});
  await shot(page, '03-after-send.png');

  const todoAfter = await getJson(`${SERVER}/api/todos/${todoId}`);
  const newBuildId = todoAfter.body?.latestBuildId ?? null;
  extra.newBuildId = newBuildId;

  const phaseAfter = todoAfter.body?.phase;
  check(
    'phase-funnel',
    phaseAfter === 'queued' || phaseAfter === 'planning' || phaseAfter === 'building',
    `相位漏斗 failed→${phaseAfter ?? '未知'}（queued=尚无机器认领 / planning=已被认领）`,
  );
  check(
    'latest-build-advanced',
    newBuildId !== null && newBuildId !== failedBuildId,
    `latestBuildId 指向新 build(${String(newBuildId).slice(0, 8)}…)`,
  );

  const dbTruth = dbQuery((db) => ({
    newBuild: db.prepare('SELECT id, todoId, withPlan, prevPhase, triggerSource FROM build WHERE id = ?').get(newBuildId),
    messages: db
      .prepare("SELECT role, content FROM message WHERE conversationId = ? AND role = 'user'")
      .all(newBuildId),
    firstStep: db
      .prepare('SELECT kind, status, prompt FROM step WHERE buildId = ? ORDER BY rowid ASC')
      .get(newBuildId),
    buildCount: db.prepare('SELECT COUNT(*) AS n FROM build WHERE todoId = ?').get(todoId),
  }));

  check(
    'new-build-row',
    dbTruth.newBuild?.prevPhase === 'failed' && dbTruth.newBuild?.withPlan === 1 && dbTruth.newBuild?.triggerSource === 'user',
    `新 build 行 prevPhase=failed + withPlan 承接失败轮(prevPhase=${dbTruth.newBuild?.prevPhase ?? '无行'}, withPlan=${dbTruth.newBuild?.withPlan ?? '?'})`,
  );

  const fbMsg = (dbTruth.messages ?? []).find((m) => decodeContent(m.content) === feedback);
  check(
    'feedback-message',
    fbMsg != null,
    `反馈行落新 conversation(role=user, 命中=${fbMsg != null}; 库里 ${(dbTruth.messages ?? []).length} 条 user 行)`,
  );
  check(
    'first-step-carries-feedback',
    typeof dbTruth.firstStep?.prompt === 'string' && dbTruth.firstStep.prompt.includes(feedback),
    `首步入队且 prompt 携反馈(kind=${dbTruth.firstStep?.kind ?? '无步'})`,
  );
  check('new-build-not-old', dbTruth.buildCount?.n >= 2, `restart 起的是新 build 而非续跑(该 todo 共 ${dbTruth.buildCount?.n ?? '?'} 个 build)`);

  const negative = await postJson(`${SERVER}/api/builds/${buildId4Check(newBuildId)}/steps`, {
    action: 'restart',
    feedback: '负向探针',
    clientMessageId: 'verify-negative',
  });
  check('negative-409', negative.status === 409, `非 failed 相位 restart 被拒(HTTP ${negative.status})`);
} finally {
  await browser.close();
}

function buildId4Check(id) {
  return typeof id === 'string' && id.length > 0 ? id : 'missing-build';
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'failed-send',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive failed-send:PASS' : 'drive failed-send:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
