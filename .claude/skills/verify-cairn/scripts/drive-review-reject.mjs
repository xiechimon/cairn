// verify-cairn probe（#701 B-C12 审核关口人肉打回全链真栈证据）：
// live 栈走真用户路径——seed 到 confirm 后由本探针把任务驱到 review 静息态
// （步已收尾、无活跃会话），然后两条打回路径各真走一遍：
//   A. 「更多」菜单 →「请求修改」→ 弹层填反馈 → 确认；
//   B. composer「请求修改…」直接输入发送（静息 review = revision 动作面，
//      不再是 steer 409 死路）。
// 每条路径断言：
//   1) UI chip 即时翻「规划中」（真 SSE 失效键路径，不 reload）；
//   2) API phase=planning + 重规划步入队（pending plan 步）；
//   3) 用户 feedback 行落 transcript（role user）；
//   4) SQLite prompt = 审核关口打回模板（含 feedback 与「会话分支」产物保留句）；
//   5) 不删产物不孤儿化：plan v1 仍在、latestBuildId 不换 build。
//
// 真值三面：HTTP API JSON + SQLite 行 + 截图；证据 = result.json。
//
// 前置：launch.mjs 起栈 + setup-review-seed.mjs 推到 confirm phase。
// 用法：VERIFY_REPO_ROOT=<worktree> REVIEW_MACHINE_TOKEN=<token> \
//      node drive-review-reject.mjs <todoId>
//   env：VERIFY_EVIDENCE_DIR（缺省主仓 .claude/verify-evidence/<ts>-review-reject）

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const todoId = process.argv[2];
if (!todoId) {
  process.stderr.write('usage: node drive-review-reject.mjs <todoId>\n');
  process.exit(2);
}
const MACHINE_TOKEN = process.env.REVIEW_MACHINE_TOKEN;
if (!MACHINE_TOKEN) {
  process.stderr.write('error: REVIEW_MACHINE_TOKEN env required (set by setup-review-seed.mjs)\n');
  process.exit(2);
}
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-review-reject`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`
  );
}

async function jget(path) {
  const res = await fetch(`${SERVER}${path}`);
  return { status: res.status, body: await res.json() };
}
async function jpost(path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = await res.text();
  }
  return { status: res.status, body: parsed };
}

/** 机器 wire 等价直驱：claim 下一 pending 步 → done success。plan 步不上传
 *  新 plan.md（v1 已在库，completeStep 判产物在即放行 confirm）。 */
async function machineClaimDone(expectKind) {
  // #951 维护轮：假机器不发心跳——enroll 的 online 窗（~90s）过期后，claim
  // 虽可命中但随即被 presence 过期释放扫尾摘走（machineId 归 null → 120s
  // 无人认领 sweep 失败步），且失联扫尾按「团队无在线机器」口径行事。每次
  // claim 前先打一拍 presence 把机器置回 online（markPresence，真 daemon
  // 30s 节拍的等价形）。2026-10-06 实测：无此拍 = build claim 恒 null。
  await jpost('/api/machine/presence', {}, MACHINE_TOKEN);
  const claimRes = await jpost('/api/machine/tasks/claim', {}, MACHINE_TOKEN);
  const claimed = claimRes.body?.step?.step ?? claimRes.body?.step;
  if (claimed?.kind !== expectKind) {
    throw new Error(`expected ${expectKind} claim, got ${JSON.stringify(claimed)}`);
  }
  const doneRes = await jpost(
    `/api/machine/done/${claimed.id}`,
    { status: 'success' },
    MACHINE_TOKEN,
  );
  if (doneRes.status !== 200) {
    throw new Error(`done ${expectKind} status=${doneRes.status}`);
  }
  return claimed;
}

/** confirm → building →（build 步成）→ review 静息态。 */
async function driveToReview(buildId) {
  const confirmRes = await jpost(`/api/builds/${buildId}/steps`, { action: 'confirm' });
  if (confirmRes.status !== 202) throw new Error(`confirm status=${confirmRes.status}`);
  await machineClaimDone('build');
  const face = await jget(`/api/todos/${todoId}`);
  if (face.body.phase !== 'review') throw new Error(`expected review, got ${face.body.phase}`);
}

const FEEDBACK_A = '关闭按钮挪到左边，文案改成「返回」';
const FEEDBACK_B = '列表页加分页，别一次全渲染';

async function chipText(page) {
  return page.textContent('.detail-chip');
}

async function waitChip(page, re) {
  await page.waitForFunction(
    (source) => {
      const el = document.querySelector('.detail-chip');
      return el !== null && new RegExp(source).test(el.textContent ?? '');
    },
    re.source,
    { timeout: 15_000 },
  );
}

/** 打回后公共断言面：API phase + pending plan 步 + feedback 行 + SQLite prompt
 *  + 产物保留（plan 行集 / latestBuildId）。返回本轮断言用的真值 JSON。 */
async function assertRejectLanded(label, buildId, feedback, expectPlanSteps) {
  const todoFace = await jget(`/api/todos/${todoId}`);
  check(`${label}-api-phase-planning`, todoFace.body.phase === 'planning', `phase=${todoFace.body.phase}`);
  check(`${label}-api-build-not-orphaned`, todoFace.body.latestBuildId === buildId, `latestBuildId=${todoFace.body.latestBuildId}`);

  const stepsFace = await jget(`/api/builds/${buildId}/steps`);
  const planSteps = (stepsFace.body ?? []).filter((s) => s.kind === 'plan');
  check(
    `${label}-api-replan-step-pending`,
    planSteps.length === expectPlanSteps && planSteps[expectPlanSteps - 1].status === 'pending',
    `plan steps=${planSteps.length}, last=${planSteps[expectPlanSteps - 1]?.status}`,
  );

  const messages = await jget(`/api/conversations/${buildId}/messages`);
  const feedbackRow = (messages.body?.messages ?? []).find(
    (m) => m.role === 'user' && m.content === feedback,
  );
  check(`${label}-api-feedback-row`, Boolean(feedbackRow), `row=${JSON.stringify(feedbackRow)}`);

  // plan v1 产物保留（打回不删方案）。
  const plans = await jget(`/api/builds/${buildId}/plans`);
  check(
    `${label}-api-plan-v1-preserved`,
    (plans.body ?? []).some((p) => p.version === 1),
    `versions=${(plans.body ?? []).map((p) => p.version).join(',')}`,
  );

  const db = new Database(DB_PATH, { readonly: true });
  const stepRow = db
    .prepare(
      `select kind, status, prompt from step where buildId = ? and kind = 'plan' and status = 'pending' order by rowid desc limit 1`,
    )
    .get(buildId);
  db.close();
  const prompt = stepRow?.prompt ?? '';
  check(
    `${label}-sqlite-prompt-review-reject-template`,
    prompt.startsWith('用户在审核关口请求修改。修改反馈：「') && prompt.includes(feedback),
    `prompt head=${prompt.slice(0, 24)}…`,
  );
  check(
    `${label}-sqlite-prompt-keeps-branch-artifacts`,
    prompt.includes('会话分支') && prompt.includes('不要丢弃既有产物'),
    'prompt 含产物保留句',
  );

  return { todo: todoFace.body, steps: stepsFace.body, messages: messages.body };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  // —— 0. seed 态确认（confirm）→ 机器 wire 驱到 review 静息态 ——
  const seedFace = await jget(`/api/todos/${todoId}`);
  check('api-seed-phase-confirm', seedFace.body.phase === 'confirm', `phase=${seedFace.body.phase}`);
  const buildId = seedFace.body.latestBuildId;
  await driveToReview(buildId);

  // —— 1. 详情页：审核 chip + 「请求修改…」composer 静息态 ——
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await waitChip(page, /审核/);
  const placeholder = await page.getAttribute('.composer-input', 'placeholder');
  check('ui-composer-placeholder-request-changes', (placeholder ?? '').includes('请求修改'), `placeholder=${placeholder}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '01-review-quiescent.png'), fullPage: true });

  // —— 2. 路径 A：更多菜单 →「请求修改」→ 弹层 ——
  await page.click('.detail-head-icon--more');
  await page.waitForSelector('.more-menu', { timeout: 5_000 });
  const rejectItem = page.locator('.more-menu-item[data-action="reject"]');
  check('ui-more-menu-reject-entry', (await rejectItem.count()) === 1, '更多菜单出现打回行');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(EVIDENCE, '02-more-menu-reject-entry.png') });
  await rejectItem.click();
  // #951/#910 载体：.dlg-reject/.reject-confirm/.reject-feedback-input 类钩退役 →
  // role=dialog 可及名 + role=button 文案 + role=textbox 一级。
  await page.waitForSelector('[role="dialog"][aria-label="请求修改"]', { timeout: 5_000 });
  const confirmDisabledEmpty = await page.locator('[role="dialog"][aria-label="请求修改"]').getByRole('button', { name: '请求修改' }).isDisabled();
  check('ui-reject-dialog-empty-blocked', confirmDisabledEmpty, '空稿确认钮禁用');
  await page.locator('[role="dialog"][aria-label="请求修改"]').getByRole('textbox').fill(FEEDBACK_A);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '03-reject-dialog-filled.png') });
  await page.locator('[role="dialog"][aria-label="请求修改"]').getByRole('button', { name: '请求修改' }).click();

  // chip 即时翻「规划中」= 真 SSE 失效键路径（不 reload）。
  await waitChip(page, /规划中/);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '04-chip-flipped-planning.png'), fullPage: true });
  check('ui-chip-flip-planning-no-reload', (await chipText(page)).includes('规划中'), 'chip 即时翻');

  await assertRejectLanded('A', buildId, FEEDBACK_A, 2);

  // —— 3. 驱回 review（重规划步 claim→done → confirm → build claim→done）——
  await machineClaimDone('plan');
  await driveToReview(buildId);
  await page.reload({ waitUntil: 'networkidle' });
  await waitChip(page, /审核/);

  // —— 4. 路径 B：composer 静息发送 = 打回（不再撞 steer 409）——
  await page.fill('.composer-input', FEEDBACK_B);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(EVIDENCE, '05-composer-reject-typed.png'), fullPage: true });
  await page.press('.composer-input', 'Enter');
  await waitChip(page, /规划中/);
  const draftAfter = await page.inputValue('.composer-input');
  check('ui-composer-draft-cleared', draftAfter === '', `draft=${JSON.stringify(draftAfter)}`);
  const rejectLine = await page.$('.composer-reject');
  check('ui-no-reject-hint-line', rejectLine === null, '无「消息未送出」提示行（发送成功）');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '06-composer-reject-flipped.png'), fullPage: true });

  await assertRejectLanded('B', buildId, FEEDBACK_B, 3);

  // —— 5. transcript 终屏：两条 feedback 用户气泡都在 ——
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const bubbleA = await page.locator('.chat-bubble', { hasText: FEEDBACK_A }).count();
  const bubbleB = await page.locator('.chat-bubble', { hasText: FEEDBACK_B }).count();
  check('ui-transcript-feedback-bubbles', bubbleA >= 1 && bubbleB >= 1, `A=${bubbleA} B=${bubbleB}`);
  await page.screenshot({ path: join(EVIDENCE, '07-transcript-feedback-rows.png'), fullPage: true });

  writeFileSync(
    join(EVIDENCE, 'result.json'),
    `${JSON.stringify(
      {
        probe: 'drive-review-reject',
        ticket: 701,
        stack: { server: SERVER, web: WEB, db: DB_PATH },
        todoId,
        buildId,
        checks,
        pass: checks.filter((c) => c.ok).length,
        total: checks.length,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `\n${checks.filter((c) => c.ok).length}/${checks.length} checks PASS — evidence: ${EVIDENCE}\n`,
  );
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
} finally {
  await browser.close();
}
