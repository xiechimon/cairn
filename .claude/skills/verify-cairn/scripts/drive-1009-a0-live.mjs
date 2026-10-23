#!/usr/bin/env node
// verify-cairn 定制 probe — #1009 A0 原型（ADR 0013 壳形态反转：贴右竖板 →
// Multica 式悬浮窗）的 live 面取证。纯 live 栈（launch.mjs，8791/5273，
// scratch CAIRN_HOME）：REST 铺底（agent + chief 绑定 + 真线程消息 + 任务），
// 零 daemon 零 LLM——A0 是壳面，消息行落库即可见，不需要执行机。
//
// 取证面（fixture 面 smoke 的 live 补腿，两腿合起来 = A0 原型证据全集）：
//  L1 真数据下的窗形态（380×600@8、fixed、12px 圆角、--z-floating、不透明卡底、
//     edge-ring+floating-shadow 双层投影）+ 真线程 chip / 真消息行
//  L2 最小化 = 在 DOM 但 hidden（D6 常驻契约）；草稿跨最小化保留
//  L3 整页刷新恢复开态（D5：0004 D9「开态刷新即关」的反转，live 面专属）
//  L4 ⌘J 开合 + Esc 永不关面板（D3）
//  L5 跨路由常驻（D6：SPA 导航不重挂，窗与草稿都在）
//  L6 detail 面：RightPane 与窗共存（D7 互斥退役）+ unreadOnly FAB 门（#443：
//     live 零未读 → detail 无 FAB）
//  L7 ?chief=settings 深链 → board 设置视图内容交换（D9 承载不变）
//  L8 ?chief=<threadId> 深链 → 开窗定位线程、消费即剥参（XMON-106 上收根 host）
//  L9 抑制路由（agent 详情 / 机器授权）零 FAB 零窗（覆盖面 = 现状）
//
// 用法（栈必须先在跑）：
//   node .claude/skills/verify-cairn/scripts/launch.mjs
//   node .claude/skills/verify-cairn/scripts/drive-1009-a0-live.mjs
// 证据落 VERIFY_EVIDENCE_DIR（缺省 = 脚本目录）；归档进 docs/verify/1009/。

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
  await page.waitForTimeout(400); // 进场动画（fade+zoom 200ms）落定再量几何
}

async function main() {
  // ---- seed（REST 铺底，公开面）----
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

  // ---- L1 真数据下的窗形态 ----
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

  // ---- L2 最小化 = 在 DOM 但 hidden；草稿保留 ----
  await win(page).getByTestId('chief-composer-input').fill('a0-live-draft');
  await win(page).getByRole('button', { name: '最小化' }).click();
  await win(page).waitFor({ state: 'hidden' });
  check('L2 minimized window stays in DOM', await win(page).count() === 1, true);
  check('L2 FAB returns after minimize', await fab(page).isVisible(), true);
  await fab(page).click();
  await settleWindow(page);
  check('L2 draft survives minimize', await win(page).getByTestId('chief-composer-input').inputValue().then((v) => v === 'a0-live-draft'), 'expect a0-live-draft');

  // ---- L3 整页刷新恢复开态（D5 live 面持久化）----
  await page.reload({ waitUntil: 'networkidle' });
  await settleWindow(page);
  check('L3 reload restores the open window (localStorage)', await win(page).isVisible(), true);
  // 草稿跨整页刷新不在 A0 射程（D5 只持久化开态；草稿是 wire 内存态，
  // 与现状 main 同行为——Multica 的草稿 per-workspace 持久化如需对齐另票）。
  await shot(page, 'live-03-reload-restored.png');

  // ---- L4 ⌘J 开合 + Esc 永不关（D3）----
  await page.keyboard.press('Meta+j');
  await win(page).waitFor({ state: 'hidden' });
  check('L4 ⌘J minimizes', await fab(page).isVisible(), true);
  await page.keyboard.press('Meta+j');
  await settleWindow(page);
  check('L4 ⌘J reopens', await win(page).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('L4 Escape never closes the window (D3)', await win(page).isVisible(), true);

  // ---- L5 跨路由常驻（D6）----
  await win(page).getByTestId('chief-composer-input').fill('a0-live-draft');
  await page.getByRole('link', { name: '定时', exact: true }).first().click();
  await page.waitForURL('**/app/schedules**');
  check('L5 window rides the SPA navigation', await win(page).isVisible(), true);
  check('L5 draft rides the SPA navigation', await win(page).getByTestId('chief-composer-input').inputValue().then((v) => v === 'a0-live-draft'), 'expect a0-live-draft');
  await shot(page, 'live-05-schedules-window-open.png');

  // ---- L6 detail：RightPane 共存 + unreadOnly FAB 门（#443）----
  await page.goto(`${WEB}/app/todo/${todo.id}`, { waitUntil: 'networkidle' });
  await settleWindow(page);
  // RightPane 与窗共存的行为证据 = detail-3pane e2e（A0 下 pane-state 组全绿，
  // 唯 418-dock 态 pin 红 = 重钉账）；live 面本 seed 是 fresh 任务（无 build，
  // XMON-55 P0 整栏不渲染律），此腿取「窗压 detail 双列、中心列照常」位形。
  check('L6 window floats over the detail face, center column intact', await win(page).isVisible() && await page.locator('.detail-center').isVisible(), true);
  await shot(page, 'live-06-detail-window-rightpane.png');
  await win(page).getByRole('button', { name: '最小化' }).click();
  await win(page).waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  check('L6 detail FAB gated on unread (#443: zero unread = no FAB)', await page.locator('.chief-fab').count().then((n) => n === 0), 'expect 0');

  // ---- L7 ?chief=settings 深链 → board 设置视图（D9）----
  await page.goto(`${WEB}/app?chief=settings`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '总管设置' }).waitFor({ state: 'visible' });
  check('L7 settings deep link swaps board content', await page.getByRole('heading', { name: '总管设置' }).isVisible(), true);
  // 退场动画窗（--dur-overlay 200ms）内 isVisible 仍真——等 hidden 落定再判
  await win(page).waitFor({ state: 'hidden' }).catch(() => {});
  check('L7 settings swap keeps the window shut', !(await win(page).isVisible()), 'expect closed');
  check('L7 deep-link param consumed (stripped from URL)', new URL(page.url()).searchParams.get('chief') === null, page.url());
  await shot(page, 'live-07-settings-deeplink.png');

  // ---- L8 ?chief=<threadId> 深链 → 开窗定位线程（XMON-106）----
  if (seed.threadId != null) {
    await page.goto(`${WEB}/app?chief=${seed.threadId}`, { waitUntil: 'networkidle' });
    await settleWindow(page);
    check('L8 thread deep link opens the window', await win(page).isVisible(), true);
    check('L8 thread deep link param consumed', new URL(page.url()).searchParams.get('chief') === null, page.url());
    check('L8 window shows the deep-linked thread', await win(page).getByTestId('chief-stream').innerText().then((s) => s.includes('A0 悬浮窗实审探针消息')), true);
  } else {
    check('L8 thread deep link (skipped: seed carried no thread id)', false, 'POST threads response lacked thread.id');
  }

  // ---- L9 抑制路由零 chief 面 ----
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
