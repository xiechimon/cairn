#!/usr/bin/env node

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
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-mentions`);
mkdirSync(EVIDENCE, { recursive: true });

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

const AGENT_TOKEN = /\[[^\]]+\]\(agent:[^)]+\)/;
const extra = {};
const stamp = Date.now() % 100000;
const title = `提及验证任务 ${stamp}`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

async function drivePicker(scopeSelector) {
  await page.click(`${scopeSelector} button[aria-label="提及"]`);
  await page.waitForSelector('.mention-picker', { timeout: 8000 });
  const topRows = await page.locator('.mention-row--top').count();
  const rowInfo = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-row--top')].map((el) => ({
      label: el.querySelector('.mention-row-label')?.textContent?.trim() ?? '',
      count: Number(el.querySelector('.mention-row-count')?.textContent ?? '-1'),
      disabled: el.disabled,
    })),
  );
  const agentRow = page.locator('.mention-row--top[aria-label^="Agents"]');
  await agentRow.click();
  await page.waitForSelector('.mention-row--entry', { timeout: 8000 });
  const entryLabel = (await page.locator('.mention-row--entry .mention-row-title').first().textContent())?.trim();
  await page.locator('.mention-row--entry').first().click();
  const insertLabel = (await page.locator('.mention-picker-insert').textContent())?.trim();
  await page.click('.mention-picker-insert');
  await page.waitForSelector('.mention-picker', { state: 'hidden', timeout: 8000 });
  return { topRows, rowInfo, entryLabel, insertLabel };
}

try {

  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  await page.click('.sidebar-new-task');
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });

  await page.fill('.new-task-spec', title);
  check('dialog-open', true, '新建任务 dialog 打开');

  const pickerInfo = await drivePicker('.new-task-dialog');
  extra.pickerRows = pickerInfo.rowInfo;
  check('picker-five-groups', pickerInfo.topRows === 5, `picker 五分组行(${pickerInfo.topRows} 行)`);
  check(
    'picker-zero-count-disabled-not-hidden',
    pickerInfo.rowInfo.every((r) => (r.count === 0 ? r.disabled === true : r.disabled === false)),
    `0 计数组行是 disabled 而非消失(${pickerInfo.rowInfo.map((r) => `${r.label}:${r.count}`).join(' ')})`,
  );
  check('agents-group-nonempty', (pickerInfo.rowInfo.find((r) => r.label === 'Agents')?.count ?? 0) >= 1, 'Agents 组非空（前置:有 agent）');
  check(
    'insert-button-count',
    pickerInfo.insertLabel === '插入 (1)',
    `底条按钮计数随选中数(${pickerInfo.insertLabel ?? '缺失'})`,
  );

  const specValue = await page.locator('.new-task-spec').inputValue();
  const specToken = specValue.match(AGENT_TOKEN);
  check('spec-agent-token', specToken != null, `spec 出现 agent token(${specToken?.[0] ?? '缺失'})`);
  extra.specToken = specToken?.[0] ?? null;
  await shot(page, '01-dialog-spec-token.png');

  await page.click('.new-task-save');
  await page.waitForSelector('.new-task-dialog', { state: 'hidden', timeout: 5000 });
  const todos = await getJson(`${SERVER}/api/todos`);

  const apiTodo = Array.isArray(todos)
    ? todos.find((t) => typeof t.title === 'string' && t.title.startsWith(title))
    : undefined;
  check(
    'api-spec-token',
    typeof apiTodo?.spec === 'string' && AGENT_TOKEN.test(apiTodo.spec),
    `GET /api/todos 的 spec 携 token(${apiTodo ? '命中任务' : '任务缺失'})`,
  );
  extra.todoId = apiTodo?.id ?? null;

  if (todoId) {
    await page.goto(`${WEB}/app/todo/${todoId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.composer-input', { timeout: 15_000 });
    const composerInfo = await drivePicker('.composer');
    const draft = await page.locator('.composer-input').inputValue();
    check(
      'composer-picker-token',
      AGENT_TOKEN.test(draft),
      `composer draft 出 agent token(${draft.match(AGENT_TOKEN)?.[0] ?? '缺失'})`,
    );
    extra.composerToken = draft.match(AGENT_TOKEN)?.[0] ?? null;
    await shot(page, '02-composer-picker-token.png');

    await page.fill('.composer-input', '');
    await page.click('.composer-input');
    await page.keyboard.type('@');
    await page.waitForSelector('.mention-inline', { timeout: 8000 });
    check('inline-opens', true, '键入 @ 触发内联 agents 补全');
    const inlineRows = await page.locator('.mention-inline-row').count();
    await page.locator('.mention-inline-row').first().click();
    const inlineDraft = await page.locator('.composer-input').inputValue();
    check(
      'inline-inserts-token',
      AGENT_TOKEN.test(inlineDraft),
      `内联选行后落 token(${inlineRows} 行候选；${inlineDraft.match(AGENT_TOKEN)?.[0] ?? '缺失'})`,
    );
    await shot(page, '03-composer-inline-token.png');
  }
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'mentions',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive mentions:PASS' : 'drive mentions:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
