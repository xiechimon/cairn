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

const SERVER = `http://127.0.0.1:${ports.serverPort ?? ports.server ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? ports.web ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const todoId = process.argv[2];
if (!todoId) {
  process.stderr.write('usage: node drive-stop.mjs <todoId>\n');
  process.exit(2);
}
const DAEMON_HOME = process.env.STOP_DAEMON_HOME ?? '/tmp/cairn-stop-daemon-home';
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-stop-button`);
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

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(EVIDENCE, '00-detail-fresh.png') });

  await page.click('.fresh-start');

  await page.waitForSelector('.overlay-panel', { timeout: 5_000 });
  await page.getByRole('button', { name: '先做规划', exact: true }).click();
  await page.waitForSelector('.composer-stop', { timeout: 90_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(EVIDENCE, '01-streaming-stop-button.png') });
  check('stop-button-visible', true, 'streaming 中 composer-stop 渲染且可点');

  await page.click('.composer-stop');
  await page.waitForSelector('[role="dialog"][aria-label="停止当前这一轮？"]', { timeout: 5_000 });

  const checked = await page.$eval('[role="dialog"] .ui-checkbox input[type="checkbox"]', (el) => el.checked);
  const label = await page.$eval('[role="dialog"] .ui-checkbox > span:last-of-type', (el) => el.textContent);
  await page.screenshot({ path: join(EVIDENCE, '02-stop-confirm-dialog.png') });
  check('dialog-default-checked', checked === true, `checkbox checked=${checked}`);
  check(
    'dialog-discard-label',
    label === '丢弃本轮修改——方案和代码回到上一个版本',
    `label=${label}`,
  );

  await page.locator('[data-testid="dialog-foot"]').getByRole('button', { name: '停止' }).click();
  let sawStopping = false;
  try {
    await page.waitForSelector('.chat-streaming-label:has-text("正在停止…")', { timeout: 4_000 });
    sawStopping = true;
    await page.screenshot({ path: join(EVIDENCE, '03-stopping-transition.png') });
  } catch {

    await page.screenshot({ path: join(EVIDENCE, '03-stopping-transition-missed.png') });
  }
  check('stopping-transition', sawStopping, sawStopping ? '「正在停止…」上屏' : '窗口过窄未截获');

  await page.waitForSelector('.chat-stamp-cancelled', { timeout: 60_000 });
  const cancelledText = await page.$eval('.chat-stamp-cancelled', (el) => el.textContent);

  await page.waitForSelector('.detail-head-action:has-text("开始")', { timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(EVIDENCE, '04-cancelled-run-row.png'), fullPage: true });
  check('cancelled-run-row', cancelledText === '已取消', `stamp=${cancelledText}`);

  const todo = await jget(`/api/todos/${todoId}`);
  const buildId = todo.body.latestBuildId;
  check('api-todo-phase-fallback', todo.body.phase === 'todo', `phase=${todo.body.phase}`);
  const buildFace = await jget(`/api/builds/${buildId}`);
  check(
    'api-build-cancelled',
    buildFace.body.errorMessage === '已取消',
    `errorMessage=${buildFace.body.errorMessage}`,
  );
  const steps = await jget(`/api/builds/${buildId}/steps`);
  const stoppedSteps = steps.body.filter((s) => s.status === 'stopped');
  check('api-step-stopped', stoppedSteps.length === 1, JSON.stringify(steps.body));
  const lateStop = await fetch(`${SERVER}/api/builds/${buildId}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ discard: true }),
  });
  check('api-late-stop-409', lateStop.status === 409, `status=${lateStop.status}`);

  const db = new Database(DB_PATH, { readonly: true });
  const stepRows = db.prepare('select id, kind, status from step where buildId = ?').all(buildId);
  const buildRow = db
    .prepare('select id, errorMessage, prevPhase from build where id = ?')
    .get(buildId);
  const pendingRows = db.prepare('select count(*) as n from stop_pending').get();
  const todoRow = db.prepare('select phase, v from todo where id = ?').get(todoId);
  db.close();
  check(
    'sqlite-step-stopped',
    stepRows.every((r) => r.status === 'stopped'),
    JSON.stringify(stepRows),
  );
  check('sqlite-build-cancelled', buildRow.errorMessage === '已取消', JSON.stringify(buildRow));
  check('sqlite-stop-pending-cleared', pendingRows.n === 0, `stop_pending rows=${pendingRows.n}`);
  check('sqlite-todo-phase', todoRow.phase === 'todo', JSON.stringify(todoRow));

  const daemonLog = readFileSync(join(DAEMON_HOME, 'daemon.log'), 'utf8');
  check(
    'daemon-stop-delivered',
    daemonLog.includes('stop delivered step='),
    daemonLog
      .split('\n')
      .filter((l) => l.includes('stop'))
      .join(' | '),
  );
  check('daemon-step-stopped', daemonLog.includes('step stopped by user (discard=true)'));

  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify(
      {
        probe: 'stop-button (#308 custom, scripts/drive-stop.mjs)',
        at: new Date().toISOString(),
        stack: { server: SERVER, web: WEB, todoId: todoId, buildId, daemonHome: DAEMON_HOME },
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
