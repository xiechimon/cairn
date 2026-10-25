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

async function machineClaimDone(expectKind) {

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

  const seedFace = await jget(`/api/todos/${todoId}`);
  check('api-seed-phase-confirm', seedFace.body.phase === 'confirm', `phase=${seedFace.body.phase}`);
  const buildId = seedFace.body.latestBuildId;
  await driveToReview(buildId);

  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await waitChip(page, /审核/);
  const placeholder = await page.getAttribute('.composer-input', 'placeholder');
  check('ui-composer-placeholder-request-changes', (placeholder ?? '').includes('请求修改'), `placeholder=${placeholder}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '01-review-quiescent.png'), fullPage: true });

  await page.click('.detail-head-icon--more');
  await page.waitForSelector('.more-menu', { timeout: 5_000 });
  const rejectItem = page.locator('.more-menu-item[data-action="reject"]');
  check('ui-more-menu-reject-entry', (await rejectItem.count()) === 1, '更多菜单出现打回行');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(EVIDENCE, '02-more-menu-reject-entry.png') });
  await rejectItem.click();

  await page.waitForSelector('[role="dialog"][aria-label="请求修改"]', { timeout: 5_000 });
  const confirmDisabledEmpty = await page.locator('[role="dialog"][aria-label="请求修改"]').getByRole('button', { name: '请求修改' }).isDisabled();
  check('ui-reject-dialog-empty-blocked', confirmDisabledEmpty, '空稿确认钮禁用');
  await page.locator('[role="dialog"][aria-label="请求修改"]').getByRole('textbox').fill(FEEDBACK_A);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '03-reject-dialog-filled.png') });
  await page.locator('[role="dialog"][aria-label="请求修改"]').getByRole('button', { name: '请求修改' }).click();

  await waitChip(page, /规划中/);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '04-chip-flipped-planning.png'), fullPage: true });
  check('ui-chip-flip-planning-no-reload', (await chipText(page)).includes('规划中'), 'chip 即时翻');

  await assertRejectLanded('A', buildId, FEEDBACK_A, 2);

  await machineClaimDone('plan');
  await driveToReview(buildId);
  await page.reload({ waitUntil: 'networkidle' });
  await waitChip(page, /审核/);

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
