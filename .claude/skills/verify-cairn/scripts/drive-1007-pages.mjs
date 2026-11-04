#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

let stack;
try {
  stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
} catch {
  console.error(`无栈:${join(RUN_DIR, 'ports.json')} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const DB_PATH = join(stack.homeDir, 'server', 'server.db');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1007-pages`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const payloads = {};
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};

const api = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body == null ? {} : { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {

  }
  return { status: res.status, json, text };
};

const dbQuery = (fn) => {
  try {
    const requireServer = createRequire(join(ROOT, 'apps', 'server', 'package.json'));
    const Database = requireServer('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
const shot = (name) => page.screenshot({ path: join(EVIDENCE, name) });

try {

  const proj = await api('POST', '/api/projects', { name: 'verify-1007-settings' });
  const projectId = proj.json?.id;
  payloads.projectCreate = proj.json;
  check((proj.status === 200 || proj.status === 201) && projectId != null, `seed:REST 建项目成功(id=${projectId})`);
  const todo = await api('POST', `/api/projects/${projectId}/todos`, {
    title: 'verify 1007 定时面种子',
    spec: '定时面种子任务,verify-cairn 探针道具。',
  });
  const todoId = todo.json?.id;
  payloads.todoCreate = todo.json;
  check((todo.status === 200 || todo.status === 201) && todoId != null, `seed:REST 建任务成功(id=${todoId})`);

  await page.goto(`${WEB}/app/schedules`, { waitUntil: 'load' });
  await page.locator('.page-new-action').click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await dialog.waitFor({ state: 'visible', timeout: 8000 });

  check(
    (await page.locator('[data-slot="dialog-overlay"]').count()) === 1 &&
      (await page.locator('[data-slot="dialog-content"]').count()) === 1,
    '弹层载体 = registry Dialog（overlay + content 槽各一）',
  );
  await shot('01-sched-dialog-open.png');

  await dialog.getByRole('tab', { name: '每周' }).click();
  check(
    (await dialog.getByRole('tab', { name: '每周' }).getAttribute('aria-selected')) === 'true',
    '频率分段 = registry Tabs：切「每周」后 aria-selected 真',
  );

  await page.locator('button[aria-label="时"]').click();
  await page.getByRole('option', { name: '08', exact: true }).click();
  check(
    (await page.locator('button[aria-label="时"]').textContent())?.includes('08') === true,
    '时 Select 选 08 回显触发钮',
  );
  await dialog.getByRole('button', { name: '保存' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 8000 });
  const cardRow = page.locator('.sched-card');
  await expectVisible(cardRow);
  async function expectVisible(loc) {
    await loc.first().waitFor({ state: 'visible', timeout: 8000 });
  }
  const cardText = (await cardRow.first().textContent()) ?? '';
  check(
    cardText.includes('每周运行') && cardText.includes('08:00'),
    `保存落面：卡行含「每周运行 / 08:00」(实际「${cardText.slice(0, 60)}」)`,
  );

  const chipTone = await cardRow.first().locator('[data-slot="badge"]').getAttribute('data-tone');
  check(chipTone != null, `卡面 chip = StatusChip 适配层(data-tone=${chipTone})`);
  await shot('02-sched-card.png');

  const schedRows = dbQuery((db) => ({
    rows: db
      .prepare('select "todoId", "kind", "at" from schedule order by rowid desc limit 1')
      .all(),
  }));
  payloads.scheduleRow = schedRows.rows;
  const row = schedRows.rows?.[0];
  const atHour = row ? new Date(row.at + 8 * 3_600_000).getUTCHours() : -1;

  check(
    schedRows.ok === true && row?.kind === 'weekly' && row?.todoId != null && atHour === 8,
    `SQLite:schedule 行 kind=weekly + todoId 在位 + at 折 +08 时区 = 8 点(实际 ${JSON.stringify(row)})`,
  );

  await page.locator('.page-new-action').click();
  await dialog.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 8000 });
  check(true, 'Esc 关面（Base UI 原生 dismiss）');
  await page.locator('.page-new-action').click();
  await dialog.waitFor({ state: 'visible' });
  await page.mouse.click(60, 60);
  await dialog.waitFor({ state: 'hidden', timeout: 8000 });
  check(true, '背板点击关面（原生 outside-press，#425 裁决接受穿透）');
  await page.locator('.page-new-action').click();
  await dialog.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '关闭' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 8000 });
  check(true, 'X 关面（自携 DialogClose，aria-label=t(关闭)）');

  await page.goto(`${WEB}/app/project/${projectId}/settings`, { waitUntil: 'load' });
  const cards = page.locator('[data-slot="card"]');
  await cards.first().waitFor({ state: 'visible', timeout: 8000 });
  const cardCount = await cards.count();
  const headCount = await page.locator('[data-slot="card-header"]').count();
  const rowCount = await page.locator('[data-slot="card-content"]').count();
  check(
    cardCount >= 2 && headCount >= 1 && rowCount >= 4,
    `设置页 = registry Card 结构(card ${cardCount} / header ${headCount} / content 行 ${rowCount})`,
  );
  check(
    (await page.locator('[data-slot="panel"]').count()) === 0,
    '设置页零 Panel 残留（data-slot=panel 计数 0）',
  );
  await shot('03-settings-card.png');
} catch (err) {
  check(false, `探针异常:${String(err).split('\n')[0]}`);
  await shot('99-crash.png').catch(() => undefined);
} finally {
  await browser.close();
  writeFileSync(
    join(EVIDENCE, 'result.json'),
    JSON.stringify({ probe: 'drive-1007-pages', stack, checks, payloads }, null, 2),
  );
  console.log(`\n${checks.length - failures}/${checks.length} PASS  evidence=${EVIDENCE}`);
  process.exit(failures === 0 ? 0 : 1);
}
