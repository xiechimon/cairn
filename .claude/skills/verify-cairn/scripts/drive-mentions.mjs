#!/usr/bin/env node
// verify-cairn drive-mentions — @提及真用户路径（#311/#327，r9 §3.2）。
//
// 路径 A（默认跑）：新建任务对话框——工具条「提及」钮 → 五分组 MentionPicker
//   → 进 Agents 分组选一行 → 底条「插入 (N)」→ spec 出现 `[名](agent:{id})`
//   token → 保存 → todo.spec 携 token。
// 路径 B（argv 给 todoId 时追加）：详情页 composer——picker 路径 + 内联 `@`
//   补全路径，token 落 draft。
//
// 真值：token 是**文本约定**（`[名](agent:{id})` / 任务 `#seq`），无 server 侧
// mention 表——所以断言落在 spec/draft 文本 + `GET /api/todos/{id}` 的 spec。
// 负向：空分组仍让 picker 开（显 0 计数，别把「0 计数」当死钮）——断言五组行
// 恒在，且 0 计数的组行是 disabled 而非消失。
//
// 前置：live 面需有可引用实体（至少一个 agent 才会让 Agents 组非空）。
// setup-review-seed.mjs 会建 agent/project/todo，可直接复用。
// 用法：node drive-mentions.mjs [todoId]

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
  // 断言位必须真是 boolean（本文件与 drive.mjs 的参数序相反）——写反会恒真。
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

/** 点开 picker 并在 Agents 分组选第一行，返回 picker 五组行的计数信息。 */
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
  // ---------- 路径 A：新建任务对话框 ----------
  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  await page.click('.sidebar-new-task');
  await page.waitForSelector('.new-task-dialog', { timeout: 5000 });
  // spec 15 #394：单字段正文——标题输入位移除。
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
  // spec 15 #394：标题 = 正文首行派生——mention token 与首行同行时进标题,
  // 用前缀匹配探针首行（时间戳段唯一）。
  const apiTodo = Array.isArray(todos)
    ? todos.find((t) => typeof t.title === 'string' && t.title.startsWith(title))
    : undefined;
  check(
    'api-spec-token',
    typeof apiTodo?.spec === 'string' && AGENT_TOKEN.test(apiTodo.spec),
    `GET /api/todos 的 spec 携 token(${apiTodo ? '命中任务' : '任务缺失'})`,
  );
  extra.todoId = apiTodo?.id ?? null;

  // ---------- 路径 B：详情页 composer（可选） ----------
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

    // 内联 @ 补全路径：清稿 → 键入 @ → 内联 listbox → 选行
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