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
const todoA = process.argv[2];
const todoB = process.argv[3];
if (!todoA || !todoB) {
  process.stderr.write('usage: node drive-review-700.mjs <todoA> <todoB>\n');
  process.exit(2);
}
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(REPO, `.claude/verify-evidence/${ts}-review-700`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');
const REVIEW_VERDICT_KIND = 'review_verdict';

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}

async function jget(path) {
  const res = await fetch(`${SERVER}${path}`);
  return { status: res.status, body: await res.json() };
}
function parseVerdictRow(row) {
  try {
    return JSON.parse(row.content);
  } catch {
    return null;
  }
}
const isVerdictRow = (m) =>
  m.role === 'system' && typeof m.content === 'string' && m.content.includes(REVIEW_VERDICT_KIND);

async function awaitVerdict(buildId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await jget(`/api/conversations/${buildId}/messages`);
    const row = (body?.messages ?? []).find(isVerdictRow);
    if (row) return { verdictRow: row, messages: body.messages };
    if (Date.now() > deadline) throw new Error(`verdict message not landed in ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function startReviewFromUi(page, todoId, shotName) {
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer-tool[aria-label="AI 审核"]', { timeout: 10_000 });
  await page.click('.composer-tool[aria-label="AI 审核"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  const agentRows = await page.$$('[role="dialog"][aria-label="AI 审核"] [role="option"]');
  await agentRows[0].click();
  await page.waitForTimeout(150);

  await page.locator('[role="dialog"][aria-label="AI 审核"]').getByRole('button', { name: '开始审核' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(EVIDENCE, shotName), fullPage: true });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  await startReviewFromUi(page, todoB, '01-review-b-started.png');
  const todoFaceB0 = await jget(`/api/todos/${todoB}`);
  const buildB = todoFaceB0.body.latestBuildId;
  const { verdictRow: verdictRowB } = await awaitVerdict(buildB, 90_000);
  const parsedB = parseVerdictRow(verdictRowB);
  check(
    'b-verdict-message-landed',
    parsedB?.kind === REVIEW_VERDICT_KIND,
    `conclusion=${parsedB?.verdict?.conclusion}`,
  );
  check(
    'b-extraction-failure-conclusion',
    parsedB?.verdict?.conclusion === '判定提取失败',
    `conclusion=${parsedB?.verdict?.conclusion}（区别于旧兜底「审核未返回结论」）`,
  );
  check(
    'b-extraction-error-surfaced',
    typeof parsedB?.extractionError === 'string' && parsedB.extractionError.includes('未找到'),
    `extractionError=${parsedB?.extractionError}`,
  );

  check(
    'b-legacy-fallback-absent',
    parsedB?.verdict?.conclusion !== '审核未返回结论',
    '「审核未返回结论」不再冒充提取失败',
  );
  const todoFaceB = await jget(`/api/todos/${todoB}`);
  check('b-phase-stays-confirm', todoFaceB.body.phase === 'confirm', `phase=${todoFaceB.body.phase}`);
  const stepsB = await jget(`/api/builds/${buildB}/steps`);
  check(
    'b-no-revision-step',
    (stepsB.body ?? []).filter((s) => s.kind === 'plan').length === 1,
    `plan steps=${(stepsB.body ?? []).filter((s) => s.kind === 'plan').length}`,
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const errorTag = await page.$('.chat-review-tag--error');
  const errorTagText = (await errorTag?.textContent()) ?? '';
  check(
    'ui-extraction-failure-tag',
    errorTag !== null && errorTagText.includes('判定提取失败'),
    `tag=${errorTagText}`,
  );
  const reasonOnPage = await page.textContent('body');
  check(
    'ui-extraction-error-text-visible',
    (reasonOnPage ?? '').includes('未找到 verdict JSON'),
    'daemon 原因正文在审核面渲染',
  );
  await page.screenshot({ path: join(EVIDENCE, '02-extraction-failure-row.png'), fullPage: true });
  writeFileSync(join(EVIDENCE, 'messages-b.json'), JSON.stringify(parsedB, null, 2));

  await startReviewFromUi(page, todoA, '03-review-a-started.png');
  const todoFaceA0 = await jget(`/api/todos/${todoA}`);
  const buildA = todoFaceA0.body.latestBuildId;
  const { verdictRow: verdictRowA, messages: messagesA } = await awaitVerdict(buildA, 90_000);
  const parsedA = parseVerdictRow(verdictRowA);

  check(
    'a-verdict-extracted-despite-trailing-toolcall',
    parsedA?.verdict?.conclusion === '方案在边界情况上存在硬风险，需修复两处',
    `conclusion=${parsedA?.verdict?.conclusion}`,
  );
  const aFindings = parsedA?.verdict?.findings ?? [];
  check(
    'a-blocking-findings-preserved',
    aFindings.length === 3 && aFindings.filter((f) => f.severity === 'blocking').length === 2,
    `findings=${aFindings.length} blocking=${aFindings.filter((f) => f.severity === 'blocking').length}`,
  );

  const contentOf = (m) =>
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
  const orderedA = [...messagesA].sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0));
  const jsonRowIdx = orderedA.findIndex(
    (m) => m.role === 'assistant' && contentOf(m).includes('方案在边界情况上存在硬风险'),
  );
  const toolRowIdx = orderedA.findIndex(
    (m) =>
      m.role === 'assistant' &&
      contentOf(m).includes('"kind":"toolcall"') &&
      contentOf(m).includes('set_task_meta'),
  );
  check(
    'a-519-shape-in-transcript',
    jsonRowIdx !== -1 && toolRowIdx !== -1 && toolRowIdx > jsonRowIdx,
    `verdict 文本行 #${jsonRowIdx} → set_task_meta 工具行 #${toolRowIdx}（尾部工具行在 JSON 之后）`,
  );

  const todoFaceA = await jget(`/api/todos/${todoA}`);
  check(
    'a-set-task-meta-executed',
    todoFaceA.body.title === '审核探针改题',
    `title=${todoFaceA.body.title}`,
  );

  check(
    'a-phase-planning-backflow',
    todoFaceA.body.phase === 'planning',
    `phase=${todoFaceA.body.phase}`,
  );
  const reviseNote = messagesA.find(
    (m) =>
      m.role === 'system' &&
      typeof m.content === 'string' &&
      m.content.includes('AI 审核检测到'),
  );
  check(
    'a-revise-note-landed',
    reviseNote?.content?.includes('2 处 blocking 风险') === true,
    `note=${reviseNote?.content}`,
  );
  const stepsA = await jget(`/api/builds/${buildA}/steps`);
  const planStepsA = (stepsA.body ?? []).filter((s) => s.kind === 'plan');
  check('a-two-plan-steps', planStepsA.length === 2, `plan steps=${planStepsA.length}`);
  check(
    'a-revise-step-in-flight',
    ['pending', 'claimed', 'running'].includes(planStepsA[1]?.status),
    `status=${planStepsA[1]?.status}（stub 延迟轮撑住 planning 窗口）`,
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const reviewTag = await page.$('.chat-review-tag:not(.chat-review-tag--error)');
  const findingsRendered = await page.$$('.chat-review-finding');
  check(
    'ui-review-tag-rendered',
    reviewTag !== null,
    `chat-review-tag count=${await page.$$eval('.chat-review-tag', (n) => n.length)}`,
  );
  check(
    'ui-three-findings-rendered',
    findingsRendered.length === 3,
    `findings rendered=${findingsRendered.length}`,
  );
  const noteOnPage = await page.$('text=AI 审核检测到 2 处 blocking 风险');
  check('ui-revise-note-visible', noteOnPage !== null, '调整摘要行在 transcript 渲染');
  await page.screenshot({ path: join(EVIDENCE, '04-blocking-revise-transcript.png'), fullPage: true });
  writeFileSync(join(EVIDENCE, 'messages-a.json'), JSON.stringify(parsedA, null, 2));

  const db = new Database(DB_PATH, { readonly: true });
  const sqliteVerdictB = db
    .prepare(
      `select role, content from message where conversationId = ? and role = 'system' and instr(content, ?) > 0`,
    )
    .get(buildB, REVIEW_VERDICT_KIND);
  const sqliteVerdictA = db
    .prepare(
      `select role, content from message where conversationId = ? and role = 'system' and instr(content, ?) > 0`,
    )
    .get(buildA, REVIEW_VERDICT_KIND);
  const sqliteReviseStep = db
    .prepare(`select kind, status, prompt from step where buildId = ? and kind = 'plan'`)
    .all(buildA);
  const sqliteTitle = db
    .prepare(`select title from todo where id = ?`)
    .get(todoA);
  db.close();
  check('sqlite-b-verdict-row', Boolean(sqliteVerdictB), `row=${JSON.stringify(sqliteVerdictB)}`);
  check(
    'sqlite-b-extraction-failure',
    (sqliteVerdictB?.content ?? '').includes('判定提取失败'),
    'B 行 conclusion=判定提取失败',
  );
  check('sqlite-a-verdict-row', Boolean(sqliteVerdictA), `row present`);
  check(
    'sqlite-a-conclusion-preserved',
    (sqliteVerdictA?.content ?? '').includes('方案在边界情况上存在硬风险'),
    'A 行 conclusion=stub 原文',
  );
  check(
    'sqlite-a-revise-step-prompt-injects-facts',
    (sqliteReviseStep[1]?.prompt ?? '').includes('未处理空输入') &&
      (sqliteReviseStep[1]?.prompt ?? '').includes('src/parse.ts:42'),
    'revise prompt 含 blocking fact 文件:行',
  );
  check(
    'sqlite-a-title-rewritten',
    sqliteTitle?.title === '审核探针改题',
    `title=${sqliteTitle?.title}`,
  );

  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify(
      {
        probe: 'review-700 verdict extraction (#700 B-C13, scripts/drive-review-700.mjs)',
        at: new Date().toISOString(),
        stack: { server: SERVER, web: WEB, todoA, todoB, buildA, buildB },
        verdictA: parsedA,
        verdictB: parsedB,
        checks,
        allOk: checks.every((c) => c.ok),
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\nevidence: ${EVIDENCE}\nallOk=${checks.every((c) => c.ok)}\n`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  await browser.close();
}
