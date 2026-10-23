#!/usr/bin/env node
// verify-cairn drive-failed-send — 失败面发送（带反馈重启）真用户路径（#320/#322）。
//
// 走真用户路径：failed 相位详情页 → composer 填反馈 → 发送钮 → 触发带反馈重启
// 新一轮（非 steer 语义，r9 §3.3）。
//
// 真值：相位漏斗 failed→queued / 新 build 行（prevPhase=failed + withPlan 承接
// 失败轮）/ 反馈行落**新 conversation** / 首步入队且 prompt 携用户反馈 /
// todo.latestBuildId 指向新 build；负向：非 failed 相位再发 restart → 409。
//
// 前置（怎么造出 failed 相位）：launch → launch 后起 build 留一个 pending 的
// plan 步 → **起真 daemon**（它会认领并跑该步；stub provider 不可达 → 步失败
// → todo 落 failed）→ **停掉 daemon**（否则它会接着认领 restart 起的新 build，
// 把相位推过 queued，观察面就不稳了）。
// 用法：node drive-failed-send.mjs <todoId> <failedBuildId>

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
  // 断言位必须真是 boolean（本文件与 drive.mjs 的参数序相反）——写反会恒真。
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

/** message.content 是 JSON 列：字符串字面量解回裸文本，其余原样返回。 */
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

  // 发送钮被 .detail-fab（总管悬浮钮）完全覆盖：真实 click 会被它拦截并超时
  // （fixture 与 live 面皆如此，仓内 e2e/integration 都因此改用 dispatchEvent）。
  // 这里同样走 dispatchEvent 驱动 wire，并把遮挡事实量下来记进证据——不掩盖。
  const sendBox = await page.locator('.composer-send').boundingBox();
  // elementFromPoint 给的是最内层元素（按钮里的 svg/path），要判「点到了谁」
  // 必须 closest 上溯到目标选择器——直接比 className 会永远匹配不上按钮自身
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

  // 等新 build 出现（latestBuildId 换新）
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
  // 漏斗断言不锁死在 queued：restart 先落 queued，但**有在线机器时会立刻 claim
// 规划步 → queued→planning**（phase.ts PHASE_TRANSITIONS 注「机器 claim：规划
// 步→planning」）。所以合法终态是 {queued, planning, building} 三者之一——断言
// 「离开了 failed」这个漏斗本质，具体值记进 detail。
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
  // message.content 列存的是 JSON（用户行 = JSON 字符串字面量，assistant 行 =
// 内容块数组）——断言前先解码，别拿裸文本做等值（会因引号假失败）。
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

  // 负向：相位已不是 failed，再发 restart 应被门挡（409）
  const negative = await postJson(`${SERVER}/api/builds/${buildId4Check(newBuildId)}/steps`, {
    action: 'restart',
    feedback: '负向探针',
    clientMessageId: 'verify-negative',
  });
  check('negative-409', negative.status === 409, `非 failed 相位 restart 被拒(HTTP ${negative.status})`);
} finally {
  await browser.close();
}

/** 取新 build id 做负向测试；id 缺失时给一个必然 404 的值，让负向 check 记 false 而非崩。 */
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