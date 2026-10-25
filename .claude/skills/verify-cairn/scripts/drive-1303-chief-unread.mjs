#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const expectArg = process.argv.find((a) => a.startsWith('--expect='));
const EXPECT = expectArg === '--expect=new' ? 'new' : 'old';
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write(`无栈：${portsFile} 不存在。先跑 launch.mjs\n`);
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-chief-unread-${EXPECT}`);
mkdirSync(EVIDENCE, { recursive: true });

const require = createRequire(join(REPO, 'apps/server/package.json'));
const Database = require('better-sqlite3');
const dbPath = join(stack.homeDir, 'server', 'server.db');
const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) ok 须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
}
function saveJson(name, value) {
  writeFileSync(join(EVIDENCE, name), `${JSON.stringify(value, null, 2)}\n`);
  artifacts.push(name);
}

async function sendJson(url, body, method, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function notifRow(threadId) {
  return db.prepare('SELECT id, type, entityId, snippet, readAt, createdAt FROM notification WHERE entityId = ?').get(threadId) ?? null;
}
function stepPrompt(stepId) {
  const row = db.prepare('SELECT id, prompt, status, kind FROM step WHERE id = ?').get(stepId);
  return row ?? null;
}
async function unreadChiefIds(teamId) {
  const res = await fetch(`${SERVER}/api/teams/${teamId}/notifications`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`notifications → ${res.status}`);
  const body = await res.json();
  const ids = (body.unreadThreadIds ?? []).filter((id) => String(id).startsWith('chief-'));
  return { body, ids };
}
function stepIdOf(claim) {
  return claim.body?.step?.step?.id ?? claim.body?.step?.id ?? null;
}

const TEXT_A1 = '第一条回复，同一会话。';
const TEXT_A2 = '第二条回复，仍是同一会话。';
const TEXT_WAKE = '机器回头：任务仍在跑，无需处理。';
const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;

let browser;
try {
  const teamsRes = await fetch(`${SERVER}/api/teams`, { signal: AbortSignal.timeout(8000) });
  const teams = await teamsRes.json();
  const teamId = teams[0]?.id;
  if (!teamId) throw new Error('无 team');
  const session = await (await fetch(`${SERVER}/api/auth/session`)).json();
  saveJson('00-session.json', session);

  const prov = await sendJson(`${SERVER}/api/teams/${teamId}/providers`, {
    providerId: 'stub-gw',
    label: 'Stub Gateway',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'stub-model', name: 'stub-model' }],
  });
  if (![200, 201, 409].includes(prov.status)) throw new Error(`provider → ${prov.status} ${JSON.stringify(prov.body)}`);

  const key = await sendJson(`${SERVER}/api/teams/${teamId}/api-keys`, {
    name: 'unread-probe',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const keyPlain = key.body?.plaintext ?? key.body?.token;
  if (!keyPlain) throw new Error(`api-key 无 plaintext：${JSON.stringify(key.body)}`);

  const enroll = await sendJson(
    `${SERVER}/api/machine/enroll`,
    { teamId, name: 'unread-probe-machine', cliVersion: '0.1.0' },
    'POST',
    keyPlain,
  );
  const machineToken = enroll.body?.token;
  const machineId = enroll.body?.machineId ?? enroll.body?.id ?? enroll.body?.machine?.id;
  if (enroll.status !== 200 || !machineToken || !machineId) {
    throw new Error(`enroll → ${enroll.status} ${JSON.stringify(enroll.body)}`);
  }

  const agent = await sendJson(`${SERVER}/api/teams/${teamId}/agents`, {
    displayName: '未读探针',
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId,
  });
  const agentId = agent.body?.id;
  if (![200, 201].includes(agent.status) || !agentId) {
    throw new Error(`agent → ${agent.status} ${JSON.stringify(agent.body)}`);
  }
  const bind = await sendJson(`${SERVER}/api/teams/${teamId}/chief`, { agent: { agentId } }, 'PATCH');
  if (bind.status !== 200) throw new Error(`chief bind → ${bind.status} ${JSON.stringify(bind.body)}`);

  async function openThread(content) {
    const thread = await sendJson(`${SERVER}/api/teams/${teamId}/chief/threads`, { content });
    if (thread.status !== 201) throw new Error(`threads → ${thread.status} ${JSON.stringify(thread.body)}`);
    const threadId = thread.body?.thread?.id;
    if (!threadId) throw new Error(`thread 无 id：${JSON.stringify(thread.body)}`);
    return threadId;
  }
  async function claimStep() {
    const claim = await sendJson(`${SERVER}/api/machine/tasks/claim`, {}, 'POST', machineToken);
    const stepId = stepIdOf(claim);
    if (!stepId) throw new Error(`claim 失败：${JSON.stringify(claim.body)}`);
    return stepId;
  }
  async function uploadTranscript(stepId, messages) {
    const urls = await sendJson(
      `${SERVER}/api/machine/upload-urls/${stepId}`,
      { files: [{ name: 'transcript.json' }] },
      'POST',
      machineToken,
    );
    const upload = urls.body?.uploads?.find((u) => u.name === 'transcript.json');
    if (!upload?.url) throw new Error(`upload-urls：${JSON.stringify(urls.body)}`);
    const uploadId = String(upload.url).split('/').pop();
    const put = await sendJson(
      `${SERVER}/api/machine/upload/${uploadId}`,
      { stepId, messages },
      'PUT',
      machineToken,
    );
    if (put.status !== 200) throw new Error(`PUT transcript → ${put.status} ${JSON.stringify(put.body)}`);
  }
  async function doneStep(stepId) {
    const done = await sendJson(
      `${SERVER}/api/machine/done/${stepId}`,
      { status: 'success', sessionId: `probe-${stepId}` },
      'POST',
      machineToken,
    );
    if (done.status !== 200) throw new Error(`done → ${done.status} ${JSON.stringify(done.body)}`);
  }

  const threadA = await openThread('请看一下这个任务');
  const stepA = await claimStep();
  const now = Date.now();
  await uploadTranscript(stepA, [
    { id: `a1-${stepA}`, role: 'assistant', content: TEXT_A1, createdAt: now },
    { id: `a2-${stepA}`, role: 'assistant', content: TEXT_A2, createdAt: now + 1 },
  ]);
  await doneStep(stepA);
  const msgs = await (await fetch(`${SERVER}/api/conversations/${threadA}/messages`)).json();
  const assistantCount = (msgs.messages ?? []).filter((m) => m.role === 'assistant').length;
  check('A1 同一线程两条 assistant 文本落库', assistantCount === 2, `assistant=${assistantCount}`);
  const unreadA = await unreadChiefIds(teamId);
  const rowA = notifRow(threadA);
  saveJson('01-after-user-turn.json', { unread: unreadA.body, row: rowA, assistantCount });
  check('A2 未读集含该线程且只有它（线程粒度，不是消息数）', unreadA.ids.length === 1 && unreadA.ids[0] === threadA, `ids=${unreadA.ids.join(',')}`);
  check('A3 通知 readAt 为空，snippet = 最后一条 assistant 文本', rowA?.readAt == null && rowA?.snippet === TEXT_A2, `readAt=${rowA?.readAt} snippet=${rowA?.snippet}`);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
  await page.route('**/api.dicebear.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
    }),
  );
  async function badgeText() {
    const badge = page.locator('.chief-fab .fab-badge');
    if ((await badge.count()) === 0) return null;
    return ((await badge.textContent()) ?? '').trim();
  }
  async function waitBadge(expected, label) {
    await page.goto(`${WEB}/app`);
    await page.locator('button[aria-label="总管"]').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      (exp) => {
        const el = document.querySelector('.chief-fab .fab-badge');
        const text = el ? (el.textContent ?? '').trim() : '';
        return exp === null ? !el : text === exp;
      },
      expected,
      { timeout: 15_000 },
    );
    const got = await badgeText();
    check(label, got === expected, `badge=${got}`);
    return got;
  }

  await waitBadge('1', 'A4 徽标裸数字 = 1（两条消息不计 2）');
  await page.locator('.chief-fab').screenshot({ path: join(EVIDENCE, '02-badge-1.png') });
  artifacts.push('02-badge-1.png');
  await shot(page, '03-board-badge-1.png');
  await page.locator('button[aria-label="总管"]').hover();
  const tip1 = page.locator('[data-slot="tooltip-content"]');
  await tip1.waitFor({ state: 'visible', timeout: 5000 });
  const tip1Text = ((await tip1.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  if (EXPECT === 'old') {
    check('A5 计数为 1 时 tooltip 只有快捷键', !tip1Text.includes('个总管会话有未读'), `tip=${tip1Text}`);
  } else {
    check('A5 tooltip 说明 1 个总管会话有未读', tip1Text.includes('1 个总管会话有未读'), `tip=${tip1Text}`);
  }
  await shot(page, '04-tooltip-count-1.png');

  await page.locator('button[aria-label="总管"]').click();
  await page.locator('.chief-drawer').waitFor({ state: 'visible', timeout: 8000 });
  await shot(page, '05-drawer-open.png');
  await page.locator('button[aria-label="最小化"]').click();
  await page.locator('.chief-fab').waitFor({ state: 'visible', timeout: 8000 });
  const afterOpen = await badgeText();
  const rowAfterOpen = notifRow(threadA);
  saveJson('06-after-open.json', { badge: afterOpen, row: rowAfterOpen });
  check('A6 打开线程再最小化，徽标仍是 1，readAt 仍空', afterOpen === '1' && rowAfterOpen?.readAt == null, `badge=${afterOpen} readAt=${rowAfterOpen?.readAt}`);
  await shot(page, '07-badge-after-open.png');

  const staleAt = Date.now() - EIGHT_DAYS;
  db.prepare('UPDATE chief_thread SET updatedAt = ?, lastTurnAt = ? WHERE id = ?').run(staleAt, staleAt, threadA);
  const threadB = await openThread('设一个回头提醒');
  const stepBUser = await claimStep();
  const wakeRelay = await sendJson(
    `${SERVER}/api/machine/tool/${stepBUser}`,
    { name: 'set_wake', params: { at: Date.now() - 1000, note: '回头看任务是否仍在跑' } },
    'POST',
    machineToken,
  );
  if (wakeRelay.status !== 200) throw new Error(`set_wake → ${wakeRelay.status} ${JSON.stringify(wakeRelay.body)}`);
  await doneStep(stepBUser);
  const unreadBeforeWake = await unreadChiefIds(teamId);
  check('B0 无 assistant 文本的用户步不新增未读', unreadBeforeWake.ids.includes(threadA) && !unreadBeforeWake.ids.includes(threadB), `ids=${unreadBeforeWake.ids.join(',')}`);

  const stepBWake = await claimStep();
  const wakeStep = stepPrompt(stepBWake);
  saveJson('08-wake-step.json', wakeStep);
  check('B1 tick 后领到的步 prompt 带 [wake:wake]', Boolean(wakeStep?.prompt?.startsWith('[wake:wake]')), `prompt=${wakeStep?.prompt}`);
  const rowAAfterTick = notifRow(threadA);
  const unreadAfterTick = await unreadChiefIds(teamId);
  saveJson('09-after-tick.json', { row: rowAAfterTick, unread: unreadAfterTick.body });
  if (EXPECT === 'old') {
    check('B2 8 天闲置 + tick 之后 A 仍未读（没有过期扫）', rowAAfterTick?.readAt == null && unreadAfterTick.ids.includes(threadA), `readAt=${rowAAfterTick?.readAt}`);
  } else {
    check('B2 tick 把 8 天闲置的 A 置读', rowAAfterTick?.readAt != null && !unreadAfterTick.ids.includes(threadA), `readAt=${rowAAfterTick?.readAt}`);
  }

  await uploadTranscript(stepBWake, [
    { id: `wake-${stepBWake}`, role: 'assistant', content: TEXT_WAKE, createdAt: Date.now() },
  ]);
  await doneStep(stepBWake);
  const rowB = notifRow(threadB);
  const unreadAfterWake = await unreadChiefIds(teamId);
  saveJson('10-after-wake-done.json', { row: rowB, unread: unreadAfterWake.body });
  if (EXPECT === 'old') {
    check('B3 wake 收尾走同一通知路径：snippet = wake 文本且 readAt 空，B 进入未读', rowB?.snippet === TEXT_WAKE && rowB?.readAt == null && unreadAfterWake.ids.includes(threadB), `readAt=${rowB?.readAt} snippet=${rowB?.snippet} ids=${unreadAfterWake.ids.join(',')}`);
  } else {
    check('B3 wake 收尾落库即已读，B 不进未读', rowB?.snippet === TEXT_WAKE && rowB?.readAt != null && !unreadAfterWake.ids.includes(threadB), `readAt=${rowB?.readAt} snippet=${rowB?.snippet} ids=${unreadAfterWake.ids.join(',')}`);
  }

  let guard = 0;
  while (guard < 130) {
    const cur = await unreadChiefIds(teamId);
    if (cur.ids.length >= 100) break;
    const threadId = await openThread(`补未读 ${guard}`);
    const stepId = await claimStep();
    await uploadTranscript(stepId, [
      { id: `fill-${stepId}`, role: 'assistant', content: `补未读回复 ${guard}`, createdAt: Date.now() },
    ]);
    await doneStep(stepId);
    guard += 1;
    if (guard % 20 === 0) process.stdout.write(`fill  ${guard} unread-probe threads posted\n`);
    if (threadId.length === 0) break;
  }
  const unreadFull = await unreadChiefIds(teamId);
  saveJson('11-unread-100.json', { count: unreadFull.ids.length, sample: unreadFull.ids.slice(0, 3) });
  check('C0 未读 chief 线程数 >= 100', unreadFull.ids.length >= 100, `count=${unreadFull.ids.length}`);
  const expectedBadge = EXPECT === 'new' ? '99+' : String(unreadFull.ids.length);
  await waitBadge(expectedBadge, EXPECT === 'new' ? 'C1 100+ 未读徽标渲染 99+' : 'C1 100+ 未读徽标是裸数字');
  await page.locator('.chief-fab').screenshot({ path: join(EVIDENCE, '12-badge-cap.png') });
  artifacts.push('12-badge-cap.png');
  await shot(page, '13-board-badge-cap.png');
  await page.locator('button[aria-label="总管"]').hover();
  const tipN = page.locator('[data-slot="tooltip-content"]');
  await tipN.waitFor({ state: 'visible', timeout: 5000 });
  const tipNText = ((await tipN.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  saveJson('14-tooltip.json', { text: tipNText, count: unreadFull.ids.length });
  if (EXPECT === 'new') {
    check('C2 tooltip 写出真实未读线程数', tipNText.includes(`${unreadFull.ids.length} 个总管会话有未读`), `tip=${tipNText}`);
  } else {
    check('C2 tooltip 只有快捷键，没有线程数说明', !tipNText.includes('个总管会话有未读'), `tip=${tipNText}`);
  }
  await shot(page, '15-tooltip-cap.png');
} finally {
  if (browser) await browser.close();
  db.close();
  const failed = checks.filter((c) => !c.ok);
  const result = {
    probe: 'drive-1303-chief-unread',
    expect: EXPECT,
    ok: failed.length === 0,
    passed: checks.filter((c) => c.ok).length,
    failed: failed.length,
    checks,
    artifacts,
    stack: { server: SERVER, web: WEB, homeDir: stack.homeDir },
  };
  writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`EVIDENCE ${EVIDENCE}\n`);
  process.stdout.write(`RESULT ${result.passed}/${checks.length} expect=${EXPECT}\n`);
  if (failed.length > 0) process.exit(1);
}
