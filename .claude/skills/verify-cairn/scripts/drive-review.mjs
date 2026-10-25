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
  process.stderr.write('usage: node drive-review.mjs <todoId>\n');
  process.exit(2);
}
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-review-modal`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
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

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer-tool[aria-label="AI 审核"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '01-confirm-ai-review-button.png') });
  check(
    'review-button-visible',
    (await page.$('.composer-tool[aria-label="AI 审核"]')) !== null,
    'AI 审核 toolbar 钮渲染',
  );

  await page.click('.composer-tool[aria-label="AI 审核"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });

  const dialogWidth = await page.$eval('[role="dialog"]', (el) =>
    el instanceof HTMLElement ? el.style.width : '',
  );

  const titleText = await page.$eval('[role="dialog"]', (el) => el.getAttribute('aria-label') ?? '');
  const agentRows = await page.$$('[role="dialog"][aria-label="AI 审核"] [role="option"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(EVIDENCE, '02-review-dialog-560-wide.png') });
  check(
    'dialog-560-wide',
    dialogWidth === '560px',
    `style.width=${dialogWidth || '(none)'}`,
  );
  check('dialog-title', titleText === 'AI 审核', `title=${titleText}`);
  check(
    'dialog-agent-list',
    agentRows.length >= 1,
    `agent rows=${agentRows.length}`,
  );

  await agentRows[0].click();
  await page.waitForTimeout(150);
  const selectedCount = await page.$$eval('[role="dialog"][aria-label="AI 审核"] [role="option"][aria-selected="true"]', (rows) => rows.length);
  await page.screenshot({ path: join(EVIDENCE, '03-agent-selected.png') });
  check('agent-row-selected', selectedCount === 1, `selected rows=${selectedCount}`);

  await page.locator('[role="dialog"][aria-label="AI 审核"]').getByRole('button', { name: '开始审核' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });

  await page.waitForFunction(
    () => {
      const el = document.querySelector('.composer-placeholder.composer-input');
      return (
        el instanceof HTMLTextAreaElement &&
        (el.getAttribute('placeholder') ?? '').includes('AI 审核') &&
        (el.getAttribute('placeholder') ?? '').includes('进行中')
      );
    },
    { timeout: 8_000 },
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '04-review-in-flight.png'), fullPage: true });
  const composerPlaceholder = await page.$eval(
    '.composer-placeholder.composer-input',
    (el) => el.getAttribute('placeholder') ?? '',
  );
  check(
    'composer-placeholder-in-flight',
    composerPlaceholder.includes('AI 审核') && composerPlaceholder.includes('进行中'),
    `placeholder=${composerPlaceholder}`,
  );

  const todoFace = await jget(`/api/todos/${todoId}`);
  const buildId = todoFace.body.latestBuildId;
  check('api-todo-phase-confirm', todoFace.body.phase === 'confirm', `phase=${todoFace.body.phase}`);
  const stepsFace = await jget(`/api/builds/${buildId}/steps`);
  const reviewSteps = (stepsFace.body ?? []).filter((s) => s.kind === 'review');
  check('api-review-step-queued', reviewSteps.length === 1, `review steps=${reviewSteps.length}`);
  check(
    'api-review-step-pending',
    reviewSteps[0]?.status === 'pending',
    `status=${reviewSteps[0]?.status}`,
  );

  const messages = await jget(`/api/conversations/${buildId}/messages`);
  const announceRow = (messages.body?.messages ?? []).find(
    (m) => m.role === 'user' && m.content === '发起了 AI 审核',
  );
  check(
    'api-transcript-announcement',
    Boolean(announceRow),
    `announceRow=${JSON.stringify(announceRow)}`,
  );

  const db = new Database(DB_PATH, { readonly: true });
  const sqliteReviewStep = db
    .prepare('select id, kind, status from step where buildId = ? and kind = ?')
    .get(buildId, 'review');
  const sqliteAnnounce = db
    .prepare(
      `select role, content from message where conversationId = ? and json_extract(content, '$') = ?`,
    )
    .get(buildId, '发起了 AI 审核');
  db.close();
  check(
    'sqlite-review-step',
    Boolean(sqliteReviewStep) && sqliteReviewStep.status === 'pending',
    JSON.stringify(sqliteReviewStep),
  );
  check('sqlite-announcement', Boolean(sqliteAnnounce), JSON.stringify(sqliteAnnounce));

  const claimRes = await jpost(
    '/api/machine/tasks/claim',
    {},
    process.env.REVIEW_MACHINE_TOKEN,
  );
  const claimStep = claimRes.body?.step?.step ?? claimRes.body?.step;
  check('api-claim-review-step', claimStep?.kind === 'review', `kind=${claimStep?.kind}`);
  if (claimStep?.id) {
    const doneRes = await jpost(
      `/api/machine/done/${claimStep.id}`,
      { status: 'success' },
      process.env.REVIEW_MACHINE_TOKEN,
    );
    check('api-done-review-step', doneRes.status === 200, `status=${doneRes.status}`);
  }
  const messagesAfter = await jget(`/api/conversations/${buildId}/messages`);
  const verdictRow = (messagesAfter.body?.messages ?? []).find((m) => {
    if (m.role !== 'system') return false;
    try {
      return JSON.parse(m.content)?.kind === 'review_verdict';
    } catch {
      return false;
    }
  });
  const verdictKind = verdictRow ? JSON.parse(verdictRow.content).verdict?.conclusion : undefined;
  check(
    'api-review-verdict-message',
    Boolean(verdictRow),
    `verdict message 落地(conclusion=${verdictKind ?? '缺失'})`,
  );
  const todoFaceAfter = await jget(`/api/todos/${todoId}`);
  check(
    'api-phase-still-confirm',
    todoFaceAfter.body.phase === 'confirm',
    `phase=${todoFaceAfter.body.phase}`,
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(EVIDENCE, '05-review-complete-placeholder.png'),
    fullPage: true,
  });

  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify(
      {
        probe: 'review-modal (#312 custom, scripts/drive-review.mjs)',
        at: new Date().toISOString(),
        stack: { server: SERVER, web: WEB, todoId: todoId, buildId },
        checks,
        allOk: checks.every((c) => c.ok),
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\nevidence: ${EVIDENCE}\nallOk=${checks.every((c) => c.ok)}\n`);
} finally {
  await browser.close();
}
