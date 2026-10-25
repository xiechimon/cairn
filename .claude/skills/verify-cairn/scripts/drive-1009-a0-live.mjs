#!/usr/bin/env node

import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.VERIFY_REPO_ROOT ?? resolve(SCRIPT_DIR, '../../../..');
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? SCRIPT_DIR;
mkdirSync(EVIDENCE, { recursive: true });
createRequire(join(REPO, 'apps/server/package.json'));

const VIEWPORT = { width: 1440, height: 732 };
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
const req = async (method, path, body) => {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const win = (page) => page.locator('.chief-drawer');
const fab = (page) => page.getByRole('button', { name: '总管', exact: true });

async function settleWindow(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.chief-drawer');
    return el != null && !el.hasAttribute('hidden') && el.getBoundingClientRect().width > 0;
  });
  await page.waitForTimeout(400);
}

async function main() {

  const teams = await req('GET', '/api/teams');
  const teamId = teams[0].id;
  const agent = await req('POST', `/api/teams/${teamId}/agents`, {
    displayName: 'A0 验证代理',
    provider: 'pi',
    modelId: 'glm-5.3',
  });
  await req('PATCH', `/api/teams/${teamId}/chief`, {
    agent: { agentId: agent.id, thinkingLevel: null },
  });
  const thread = await req('POST', `/api/teams/${teamId}/chief/threads`, {
    content: 'A0 悬浮窗实审探针消息',
  });
  const project = await req('POST', '/api/projects', {
    name: 'A0 取证项目',
    teamId,
  });
  const todo = await req('POST', `/api/projects/${project.id}/todos`, {
    title: 'A0 悬浮窗覆盖对照任务',
    spec: '右栏共存取证用',
  });
  const seed = { teamId, agentId: agent.id, threadId: thread.thread?.id ?? null, todoId: todo.id };
  writeFileSync(join(EVIDENCE, 'seed-a0-live.json'), `${JSON.stringify(seed, null, 2)}\n`);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' })).newPage();

  await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
  await fab(page).waitFor({ state: 'visible' });
  await fab(page).click();
  await settleWindow(page);
  const geo = await win(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      w: r.width, h: r.height,
      right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom,
      position: cs.position, radius: cs.borderRadius, z: cs.zIndex,
      bg: cs.backgroundColor, shadow: cs.boxShadow,
    };
  });
  check('L1 window geometry 380x600 @ right/bottom 8', geo.w === 380 && geo.h === 600 && geo.right === 8 && geo.bottom === 8, JSON.stringify(geo));
  check('L1 window skin (fixed / 12px / z15 / opaque / dual shadow)', geo.position === 'fixed' && geo.radius === '12px' && geo.z === '15' && geo.bg.startsWith('rgb(') && geo.shadow.includes('inset'), JSON.stringify({ position: geo.position, radius: geo.radius, z: geo.z, bg: geo.bg }));
  check('L1 live thread chip carries the real thread', await win(page).getByRole('button', { name: '主题', exact: true }).innerText().then((s) => s.includes('A0 悬浮窗实审探针消息')), true);
  check('L1 live stream carries the seeded user row', await win(page).getByTestId('chief-stream').innerText().then((s) => s.includes('A0 悬浮窗实审探针消息')), true);
  check('L1 bound chief shows the agent identity face', await win(page).locator('img').count().then((n) => n > 0), true);
  await shot(page, 'live-01-board-window-open.png');

  await win(page).getByTestId('chief-composer-input').fill('a0-live-draft');
  await win(page).getByRole('button', { name: '最小化' }).click();
  await win(page).waitFor({ state: 'hidden' });
  check('L2 minimized window stays in DOM', await win(page).count() === 1, true);
  check('L2 FAB returns after minimize', await fab(page).isVisible(), true);
  await fab(page).click();
  await settleWindow(page);
  check('L2 draft survives minimize', await win(page).getByTestId('chief-composer-input').inputValue().then((v) => v === 'a0-live-draft'), 'expect a0-live-draft');

  await page.reload({ waitUntil: 'networkidle' });
  await settleWindow(page);
  check('L3 reload restores the open window (localStorage)', await win(page).isVisible(), true);

  await shot(page, 'live-03-reload-restored.png');

  await page.keyboard.press('Meta+j');
  await win(page).waitFor({ state: 'hidden' });
  check('L4 ⌘J minimizes', await fab(page).isVisible(), true);
  await page.keyboard.press('Meta+j');
  await settleWindow(page);
  check('L4 ⌘J reopens', await win(page).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('L4 Escape never closes the window (D3)', await win(page).isVisible(), true);

  await win(page).getByTestId('chief-composer-input').fill('a0-live-draft');
  await page.getByRole('link', { name: '定时', exact: true }).first().click();
  await page.waitForURL('**/app/schedules**');
  check('L5 window rides the SPA navigation', await win(page).isVisible(), true);
  check('L5 draft rides the SPA navigation', await win(page).getByTestId('chief-composer-input').inputValue().then((v) => v === 'a0-live-draft'), 'expect a0-live-draft');
  await shot(page, 'live-05-schedules-window-open.png');

  await page.goto(`${WEB}/app/todo/${todo.id}`, { waitUntil: 'networkidle' });
  await settleWindow(page);

  check('L6 window floats over the detail face, center column intact', await win(page).isVisible() && await page.locator('.detail-center').isVisible(), true);
  await shot(page, 'live-06-detail-window-rightpane.png');
  await win(page).getByRole('button', { name: '最小化' }).click();
  await win(page).waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  check('L6 detail FAB gated on unread (#443: zero unread = no FAB)', await page.locator('.chief-fab').count().then((n) => n === 0), 'expect 0');

  await page.goto(`${WEB}/app?chief=settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '总管设置' }).waitFor({ state: 'visible' });
  check('L7 settings deep link swaps board content', await page.getByRole('heading', { name: '总管设置' }).isVisible(), true);

  await win(page).waitFor({ state: 'hidden' }).catch(() => {});
  check('L7 settings swap keeps the window shut', !(await win(page).isVisible()), 'expect closed');
  check('L7 deep-link param consumed (stripped from URL)', new URL(page.url()).searchParams.get('chief') === null, page.url());
  await shot(page, 'live-07-settings-deeplink.png');

  if (seed.threadId != null) {
    await page.goto(`${WEB}/app?chief=${seed.threadId}`, { waitUntil: 'networkidle' });
    await settleWindow(page);
    check('L8 thread deep link opens the window', await win(page).isVisible(), true);
    check('L8 thread deep link param consumed', new URL(page.url()).searchParams.get('chief') === null, page.url());
    check('L8 window shows the deep-linked thread', await win(page).getByTestId('chief-stream').innerText().then((s) => s.includes('A0 悬浮窗实审探针消息')), true);
  } else {
    check('L8 thread deep link (skipped: seed carried no thread id)', false, 'POST threads response lacked thread.id');
  }

  for (const url of [`${WEB}/app/resources/agents/${agent.id}`, `${WEB}/app/machines/authorize`]) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const counts = { fab: await page.locator('.chief-fab').count(), win: await win(page).count() };
    check(`L9 suppressed route ${new URL(url).pathname}: no FAB, no window`, counts.fab === 0 && counts.win === 0, JSON.stringify(counts));
  }
  await shot(page, 'live-09-agent-detail-suppressed.png');

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(
    join(EVIDENCE, 'result-a0-live.json'),
    `${JSON.stringify({ server: SERVER, web: WEB, viewport: VIEWPORT, seed, failed: failed.length, checks, artifacts }, null, 2)}\n`,
  );
  process.stdout.write(`\n${failed.length === 0 ? 'ALL PASS' : `FAILURES: ${failed.length}`} (${checks.length} checks)\n`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  writeFileSync(join(EVIDENCE, 'result-a0-live.json'), `${JSON.stringify({ error: String(err), checks }, null, 2)}\n`);
  process.exit(2);
});
