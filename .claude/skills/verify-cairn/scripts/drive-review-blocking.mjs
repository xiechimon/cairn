// verify-cairn probe（M7 #330 AI 审核 blocking 自动修订回路全链真栈证据）：
// live 栈走真用户路径——confirm phase → composer AI 审核钮 → 选 Agent → 发起
// → review 步 claim → done(success, 含 blocking verdict) →
// 1) REVIEW_VERDICT_KIND 消息行落地（conclusion + 编号 findings）
// 2) phase 转 planning（review → planning 自动修订回路扩展）
// 3) 调整摘要行 note 落地「AI 审核检测到 N 处 blocking 风险…」
// 4) 新 plan 步入队，prompt 注入审核事实
// 5) UI reload 后 transcript 显示 verdict 段 + 调整摘要行 + 新 plan 卡（v2）
//
// 真值三面：HTTP API JSON + SQLite 行 + 截图；证据 = result.json。
//
// 前置：launch.mjs 起栈 + setup-review-seed.mjs 推到 confirm phase。
// 用法：VERIFY_REPO_ROOT=<worktree> REVIEW_MACHINE_TOKEN=<token> \
//      node drive-review-blocking.mjs <todoId> <agentId>
//   env：VERIFY_EVIDENCE_DIR（缺省主仓 .claude/verify-evidence/<ts>-review-blocking）

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
const AGENT_ID = process.argv[3];
if (!todoId || !AGENT_ID) {
  process.stderr.write('usage: node drive-review-blocking.mjs <todoId> <agentId>\n');
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
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-review-blocking`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require2('better-sqlite3');
// REVIEW_VERDICT_KIND = shared 单源常量值；不在此复刻 zod 契约，直接
// 字面量 + hasBlockingFinding 本地实现，避免依赖 packages/shared/dist 构建。
const REVIEW_VERDICT_KIND = 'review_verdict';
function hasBlockingFinding(verdict) {
  return Array.isArray(verdict?.findings) &&
    verdict.findings.some((f) => f?.severity === 'blocking');
}

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

  // —— 1. 详情页 load + AI 审核钮可见 ——
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer-tool[aria-label="AI 审核"]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '01-confirm-ai-review-button.png') });
  check(
    'review-button-visible',
    (await page.$('.composer-tool[aria-label="AI 审核"]')) !== null,
    'AI 审核 toolbar 钮渲染',
  );

  // —— 2. 发起审核 ——
  await page.click('.composer-tool[aria-label="AI 审核"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  const agentRows = await page.$$('[role="dialog"][aria-label="AI 审核"] [role="option"]');
  await agentRows[0].click();
  await page.waitForTimeout(150);
  // #951/#910 载体：.review-start 类钩退役 → dialog scope role+文案一级。
  await page.locator('[role="dialog"][aria-label="AI 审核"]').getByRole('button', { name: '开始审核' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5_000 });
  // composer placeholder 切换证明审核入队
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
  await page.screenshot({
    path: join(EVIDENCE, '02-review-in-flight.png'),
    fullPage: true,
  });

  const todoFace = await jget(`/api/todos/${todoId}`);
  const buildId = todoFace.body.latestBuildId;
  check('api-todo-phase-confirm-before', todoFace.body.phase === 'confirm', `phase=${todoFace.body.phase}`);
  const stepsFace = await jget(`/api/builds/${buildId}/steps`);
  const reviewStepBefore = (stepsFace.body ?? []).find((s) => s.kind === 'review');
  check(
    'api-review-step-queued',
    Boolean(reviewStepBefore) && reviewStepBefore.status === 'pending',
    `review step=${JSON.stringify(reviewStepBefore)}`,
  );

  // —— 3. 模拟机器 claim review 步 → done(success, blocking verdict) ——
  const claimRes = await jpost('/api/machine/tasks/claim', {}, MACHINE_TOKEN);
  const claimStep = claimRes.body?.step?.step ?? claimRes.body?.step;
  check('api-claim-review-step', claimStep?.kind === 'review', `kind=${claimStep?.kind}`);
  if (claimStep?.kind !== 'review') {
    throw new Error(`expected review claim, got ${JSON.stringify(claimStep)}`);
  }

  // 两条 blocking findings + 一条 suggestion，注入完整 verdict 形态
  const verdict = {
    conclusion: '方案在边界情况上存在硬风险，需修复两处',
    findings: [
      {
        id: '1',
        severity: 'blocking',
        summary: '未处理空输入',
        description: 'parseInput 对空字符串未做防御',
        file: 'src/parse.ts',
        line: 42,
        suggestion: '加入空字符串 early return',
      },
      {
        id: '2',
        severity: 'blocking',
        summary: 'JSON 反序列化未捕获异常',
        description: '解析远端返回时若格式异常会冒泡到上层',
        file: 'src/parse.ts',
        line: 67,
        suggestion: 'try/catch 包 JSON.parse 并返回空对象',
      },
      {
        id: '3',
        severity: 'suggestion',
        summary: '日志格式可统一',
      },
    ],
  };
  const doneRes = await jpost(
    `/api/machine/done/${claimStep.id}`,
    { status: 'success', findings: verdict },
    MACHINE_TOKEN,
  );
  check('api-done-review-step', doneRes.status === 200, `status=${doneRes.status}`);

  // —— 4. HTTP API 真值：verdict 消息落地 + phase 转 planning + 新 plan 步入队 ——
  const messages = await jget(`/api/conversations/${buildId}/messages`);
  // REVIEW_VERDICT_KIND 系统消息（r8 §3.1 60/61）
  const verdictRow = (messages.body?.messages ?? []).find(
    (m) =>
      m.role === 'system' &&
      typeof m.content === 'string' &&
      (() => {
        try {
          const parsed = JSON.parse(m.content);
          return parsed.kind === REVIEW_VERDICT_KIND;
        } catch {
          return false;
        }
      })(),
  );
  check('api-verdict-message-landed', Boolean(verdictRow), `verdictRow=${JSON.stringify(verdictRow)}`);
  let parsedVerdict = null;
  if (verdictRow) {
    parsedVerdict = JSON.parse(verdictRow.content).verdict;
    check(
      'verdict-has-blocking-findings',
      hasBlockingFinding(parsedVerdict) === true,
      `findings=${parsedVerdict.findings.length}, blocking=${parsedVerdict.findings.filter((f) => f.severity === 'blocking').length}`,
    );
    check(
      'verdict-conclusion-preserved',
      parsedVerdict.conclusion === verdict.conclusion,
      `conclusion=${parsedVerdict.conclusion}`,
    );
  }

  // 「调整摘要行」note（系统纯文本消息，不是 JSON 行）
  const reviseNote = (messages.body?.messages ?? []).find(
    (m) =>
      m.role === 'system' &&
      typeof m.content === 'string' &&
      !m.content.startsWith('{') &&
      m.content.includes('AI 审核检测到'),
  );
  check(
    'api-revise-note-landed',
    Boolean(reviseNote),
    `reviseNote=${JSON.stringify(reviseNote)}`,
  );
  if (reviseNote) {
    check(
      'revise-note-counts-blockings',
      reviseNote.content.includes('2 处 blocking 风险'),
      `content=${reviseNote.content}`,
    );
    check(
      'revise-note-marks-auto-replan',
      reviseNote.content.includes('已自动入队重规划步'),
      `content=${reviseNote.content}`,
    );
  }

  // phase 转 planning
  const todoFaceAfter = await jget(`/api/todos/${todoId}`);
  check(
    'api-phase-planning',
    todoFaceAfter.body.phase === 'planning',
    `phase=${todoFaceAfter.body.phase}`,
  );

  // 新 plan 步入队（原 plan v1 + 新 auto-revise plan v2）
  const stepsAfter = await jget(`/api/builds/${buildId}/steps`);
  const planSteps = (stepsAfter.body ?? []).filter((s) => s.kind === 'plan');
  check('api-two-plan-steps', planSteps.length === 2, `plan steps=${planSteps.length}`);
  const reviseStep = planSteps[1];
  check(
    'api-revise-step-pending',
    reviseStep?.status === 'pending',
    `status=${reviseStep?.status}`,
  );

  // —— 5. SQLite 真值（content 列 = JSON-encoded text 字符串——leading
  //    `"` + `\"…\"` 转义包内部）。LIKE 在 better-sqlite3 默认只支持 ASCII
  //    大小写匹配，CJK 字面量 LIKE 不可靠，改用 instr() 字节级匹配 ——
  const db = new Database(DB_PATH, { readonly: true });
  const sqliteVerdict = db
    .prepare(
      `select role, content from message where conversationId = ? and role = 'system' and instr(content, ?) > 0`,
    )
    .get(buildId, 'review_verdict');
  const sqliteReviseNote = db
    .prepare(
      `select role, content from message where conversationId = ? and role = 'system' and instr(content, ?) > 0`,
    )
    .get(buildId, 'AI 审核检测到');
  // 步骤的 prompt 列 = raw TEXT，不走 JSON 包裹
  const sqliteReviseStep = db
    .prepare(
      `select kind, status, prompt from step where buildId = ? and kind = 'plan' and status = 'pending'`,
    )
    .get(buildId);
  db.close();
  check(
    'sqlite-verdict-message',
    Boolean(sqliteVerdict),
    `verdict=${JSON.stringify(sqliteVerdict)}`,
  );
  check(
    'sqlite-revise-note',
    Boolean(sqliteReviseNote) &&
      sqliteReviseNote.content.includes('2 处 blocking 风险'),
    `note=${JSON.stringify(sqliteReviseNote)}`,
  );
  check(
    'sqlite-revise-step-pending',
    Boolean(sqliteReviseStep) && sqliteReviseStep.status === 'pending',
    `step=${JSON.stringify(sqliteReviseStep)}`,
  );
  // prompt 注入审核事实（审核结论 + blocking facts + 文件:行）
  const revisePrompt = sqliteReviseStep?.prompt ?? '';
  check(
    'revise-prompt-has-conclusion',
    revisePrompt.includes('方案在边界情况上存在硬风险'),
    'revisePrompt 含审核结论',
  );
  check(
    'revise-prompt-has-blocking-summary',
    revisePrompt.includes('未处理空输入') &&
      revisePrompt.includes('src/parse.ts:42'),
    'revisePrompt 含 blocking fact 文件:行',
  );

  // —— 6. UI reload：transcript 显示 verdict 段 + 调整摘要行 ——
  // v2 plan 卡要等新 plan 步真跑出 plan.md 才渲染（r7 17 = 完成 plan 才有 plan 卡）；
  // 当前新 plan 在 pending 状态，所以这里只断言 verdict + 调整摘要行可见。
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({
    path: join(EVIDENCE, '03-blocking-revise-transcript.png'),
    fullPage: true,
  });
  const reviewTag = await page.$('.chat-review-tag');
  const reviewFindings = await page.$$('.chat-review-finding');
  const reviseNoteOnPage = await page.$('text=AI 审核检测到 2 处 blocking 风险');
  const planCards = await page.$$('.chat-plan');
  check(
    'ui-review-tag-rendered',
    Boolean(reviewTag),
    `chat-review-tag count=${await page.$$eval('.chat-review-tag', (n) => n.length)}`,
  );
  check(
    'ui-three-findings-rendered',
    reviewFindings.length === 3,
    `findings rendered=${reviewFindings.length}`,
  );
  check(
    'ui-revise-note-visible',
    Boolean(reviseNoteOnPage),
    '调整摘要行在 transcript 渲染',
  );
  check(
    'ui-original-plan-card-still-visible',
    planCards.length >= 1,
    `plan cards=${planCards.length}（v1 plan 卡在，新 plan 在 pending 未渲染 = 正确）`,
  );

  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify(
      {
        probe: 'review-blocking-revise (#330 custom, scripts/drive-review-blocking.mjs)',
        at: new Date().toISOString(),
        stack: { server: SERVER, web: WEB, todoId: todoId, buildId },
        verdict: parsedVerdict,
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
