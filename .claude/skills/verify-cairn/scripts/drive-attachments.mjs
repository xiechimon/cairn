#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const ATTACH_DIR = join(RUN_DIR, 'home/server/attachments');
const todoId = process.argv[2];
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-attachments`);
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
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
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

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});
const extra = {};

try {

  const stamp = Date.now() % 100000;
  const fileName = `verify-attachment-${stamp}.txt`;
  const fileBody = `verify-cairn 附件样本 ${stamp} @ ${new Date().toISOString()}\n`;
  const samplePath = join(EVIDENCE, fileName);
  writeFileSync(samplePath, fileBody);
  extra.sample = { fileName, bytes: Buffer.byteLength(fileBody) };

  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  check('board-ready', true, '看板 shell 就绪');
  await page.click('.sidebar-new-task');
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
  check('dialog-open', true, '新建任务 dialog 打开');
  await shot(page, '01-dialog-open.png');

  await page.setInputFiles('.new-task-dialog input[type=file]', samplePath);

  await page
    .waitForFunction(
      (sel) => (document.querySelector(sel)?.value ?? '').includes('attachment:'),
      '.new-task-spec',
      { timeout: 20_000 },
    )
    .catch(() => {});
  const specValue = await page.locator('.new-task-spec').inputValue();
  const tokenMatch = specValue.match(/!\[([^\]]+)\]\(attachment:([^)]+)\)/);
  check('spec-token', tokenMatch != null, `spec 出现 attachment token(${tokenMatch?.[0] ?? '缺失'})`);
  extra.token = tokenMatch?.[0] ?? null;
  const storageKey = tokenMatch?.[2] ?? '';
  check(
    'token-shape',
    tokenMatch?.[1] === fileName && /^[^/]+\/[^/]+\.txt$/.test(storageKey),
    `token 形态 ![名](attachment:<teamId>/<id>.txt)(${storageKey || '缺失'})`,
  );
  await shot(page, '02-spec-token.png');

  const title = `附件验证任务 ${stamp}`;
  const specWithToken = await page.locator('.new-task-spec').inputValue();
  await page.fill('.new-task-spec', `${title}\n${specWithToken}`);
  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  check('dialog-closed', true, '保存后 dialog 关闭');

  const todos = await getJson(`${SERVER}/api/todos`);
  const apiTodo = Array.isArray(todos) ? todos.find((t) => t.title === title) : undefined;
  check(
    'api-spec-token',
    typeof apiTodo?.spec === 'string' && apiTodo.spec.includes(storageKey),
    `GET /api/todos 的 spec 携 token(${apiTodo ? '命中任务' : '任务缺失'})`,
  );
  extra.todoId = apiTodo?.id ?? null;

  const dbTruth = dbQuery((db) => ({
    row: db
      .prepare(
        'SELECT id, fileName, mimeType, sizeBytes, storageKey, scope, status FROM attachment WHERE storageKey = ?',
      )
      .get(storageKey),
  }));
  const attRow = dbTruth.row;
  check(
    'db-attachment-ready',
    dbTruth.ok && attRow?.status === 'ready',
    `SQLite attachment 行 status=ready(status=${attRow?.status ?? '无行'}${dbTruth.skipped ? `,跳过:${dbTruth.reason}` : ''})`,
  );
  check(
    'db-bytes-mime',
    attRow?.sizeBytes === Buffer.byteLength(fileBody) && attRow?.mimeType === 'text/plain',
    `SQLite 行字节与 MIME 对账(${attRow?.sizeBytes ?? '?'}B / ${attRow?.mimeType ?? '?'})`,
  );
  extra.attachmentRow = attRow ?? null;

  const absPath = join(ATTACH_DIR, attRow?.storageKey ?? '');
  const diskOk = existsSync(absPath);
  check('disk-file', diskOk, `附件落盘 <attachmentsDir>/<storageKey>(${attRow?.storageKey ?? '缺失'})`);
  if (diskOk) {
    const diskBody = readFileSync(absPath, 'utf8');
    check(
      'disk-bytes',
      diskBody === fileBody && statSync(absPath).size === Buffer.byteLength(fileBody),
      `磁盘字节等于上传样本(${statSync(absPath).size}B)`,
    );
  }

  if (attRow?.id) {
    const res = await fetch(`${SERVER}/api/attachments/${attRow.id}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    check(
      'readback',
      res.status === 200 && body === fileBody,
      `GET /api/attachments/:id 读回一致(status=${res.status}, ${res.headers.get('content-type')})`,
    );
  }
  await shot(page, '03-card-saved.png');

  if (todoId) {
    await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.composer', { timeout: 15_000 });
    const composerFile = `verify-composer-${stamp}.txt`;
    const composerPath = join(EVIDENCE, composerFile);
    const composerBody = `composer 附件样本 ${stamp}\n`;
    writeFileSync(composerPath, composerBody);
    await shot(page, '04-composer-before.png');

    await page.setInputFiles('.composer input[type=file]', composerPath);
    await page
      .waitForFunction(
        (sel) => (document.querySelector(sel)?.value ?? '').includes('attachment:'),
        '.composer-input',
        { timeout: 20_000 },
      )
      .catch(() => {});
    const draft = await page.locator('.composer-input').inputValue();
    const draftMatch = draft.match(/!\[([^\]]+)\]\(attachment:([^)]+)\)/);
    check(
      'composer-draft-token',
      draftMatch?.[1] === composerFile,
      `composer draft 出现 attachment token(${draftMatch?.[0] ?? '缺失'})`,
    );
    await shot(page, '05-composer-token.png');
  }
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'attachments',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive attachments:PASS' : 'drive attachments:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
