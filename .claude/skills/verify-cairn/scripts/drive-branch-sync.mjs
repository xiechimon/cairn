#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
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

const [todoId, buildId] = process.argv.slice(2);
if (!todoId || !buildId) {
  process.stderr.write('usage: node drive-branch-sync.mjs <todoId> <buildId>\n');
  process.exit(2);
}
const siteRoot = join('/tmp', 'cairn-verify-branch-sync', buildId);
const directory = join(siteRoot, 'workspaces', buildId);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-branch-sync`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));
const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

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

const extra = {};

const expectedCommit = dbQuery((db) => ({
  row: db.prepare('SELECT checkpointCommit FROM step WHERE buildId = ? AND checkpointCommit IS NOT NULL').get(buildId),
}));
const targetCommit = expectedCommit.row?.checkpointCommit ?? '';
extra.expectedCommit = targetCommit;
check('seed-checkpoint', targetCommit.length >= 7, `step.checkpointCommit 就位(${targetCommit.slice(0, 7) || '缺失'})`);
check('seed-dirty-target', existsSync(join(directory, 'junk.txt')), `目标目录事前为脏态(${directory})`);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {
  await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });

  await page.click('.doc-select-wrap .doc-pane-select');

  await page.waitForSelector('[role="menu"]', { timeout: 10_000 });
  await page.locator('[role="menuitemradio"]', { hasText: '分支与 PR' }).click();

  await page.waitForSelector('button[aria-haspopup="listbox"]', { timeout: 10_000 });
  check('pane-section-open', true, '右 pane「分支与 PR」section 打开');
  await shot(page, '01-branch-section.png');

  check('sync-section-live', true, '同步面接真（机器 pill 走真值，非 fixture 占位）');

  await page.locator('button[aria-haspopup="listbox"]').first().click();
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  const opts = page.locator('[role="listbox"] button');
  const optCount = await opts.count();
  check('machine-online', optCount >= 1, `机器 pill 列出在线机器(${optCount} 台)`);
  await shot(page, '02-machine-menu.png');
  if (optCount >= 1) await opts.first().click();

  await page.getByLabel('同步目录').fill(directory);
  const dirValue = await page.getByLabel('同步目录').inputValue();
  check('directory-filled', dirValue === directory, `同步目录填入(${dirValue})`);

  await page.locator('[role="switch"]').check();
  const forceOn = await page.locator('[role="switch"]').isChecked();
  check('force-on', forceOn, '强制同步开关打开（force 语义：清未跟踪文件）');
  await shot(page, '03-sync-form-ready.png');

  await page.getByRole('button', { name: '同步', exact: true }).click();
  check('sync-posted', true, '「同步」钮点击');

  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-status]');
        const s = el?.getAttribute('data-status');
        return s === 'synced' || s === 'failed';
      },
      undefined,
      { timeout: 60_000 },
    )
    .catch(() => {});
  const status = await page.locator('[data-status]').getAttribute('data-status').catch(() => null);
  const stateText = await page.locator('[data-status] > div:nth-child(1)').textContent().catch(() => null);
  const errText = await page.locator('[data-status="failed"] > div:nth-child(2)').textContent().catch(() => null);
  check('result-terminal', status === 'synced', `结果卡终态(${status ?? '无卡'} / ${stateText ?? '-'}${errText ? ` / ${errText}` : ''})`);
  await shot(page, '04-result-card.png');

  const syncRow = dbQuery((db) => ({
    row: db
      .prepare(

        'SELECT id, buildId, machineId, directory, ref, "commit", "force", status, errorMessage FROM branch_sync WHERE buildId = ? ORDER BY createdAt DESC',
      )
      .get(buildId),
  }));
  const row = syncRow.row;
  extra.branchSyncRow = row ?? null;
  check(
    'db-sync-row',
    syncRow.ok && row?.status === 'synced',
    `SQLite branch_sync 行终态(status=${row?.status ?? '无行'}${syncRow.skipped ? `,跳过:${syncRow.reason}` : ''})`,
  );
  check(
    'db-sync-payload',
    row?.directory === directory && row?.ref === `cairn/conv-${buildId}` && row?.force === 1,
    `落账载荷对账(directory/ref/force=${row?.force ?? '?'})`,
  );

  const head = git(['rev-parse', 'HEAD'], directory);
  check('target-head', head === targetCommit, `目标 HEAD == checkpointCommit(${head.slice(0, 7)})`);
  const porcelain = git(['status', '--porcelain'], directory);
  check('target-clean', porcelain === '', `目标工作区干净(porcelain ${porcelain === '' ? '空' : porcelain.replace(/\n/g, '|')})`);
  check('target-junk-gone', !existsSync(join(directory, 'junk.txt')), '未跟踪文件被 force 清除');
  check('target-c2-file', existsSync(join(directory, 'b.txt')), 'C2 引入的文件在位(b.txt)');
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'branch-sync',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive branch-sync:PASS' : 'drive branch-sync:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
