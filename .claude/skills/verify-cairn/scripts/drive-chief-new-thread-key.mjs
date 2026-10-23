#!/usr/bin/env node
// verify-cairn drive-chief-new-thread-key — 抽屉新主题钮 N 键（#645）live 闭环验证。
//
// fixture e2e 钉不住的面（onNewThread 是 live-only，fixture 面钮惰性、触发零
// DOM 变化）全在这里：作用域门（抽屉关着 N 不触发）、输入态守卫（composer
// 聚焦时 n 是打字不是触发）、触发本身（线程视图 → 新主题视图 + 切换器
// popover 收）、KbdHint 悬浮与 aria-keyshortcuts。
//
// 真用户路径：/app FAB/⌘J 开 drawer；composer 键入发送建线程（线程视图落地）；
// blur 后裸按 N 落回新主题视图。铺底走公开 REST（providers/agents/PATCH chief
// agent——非被测路径，drive-chief-drawer 铺底律）。
// 依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-chief-new-thread-key.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write('无栈：' + portsFile + ' 不存在或损坏。先跑 launch.mjs\n');
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = 'http://127.0.0.1:' + (stack.serverPort ?? process.env.VERIFY_PORT ?? 8791);
const WEB = 'http://127.0.0.1:' + (stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273);
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-chief-new-thread-key');
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  if (typeof ok !== 'boolean') {
    throw new TypeError('check(' + JSON.stringify(name) + ') 的 ok 位须为 boolean，收到 ' + typeof ok);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : '') + '\n');
}
const artifacts = [];
async function shot(page, name) {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write('shot  ' + name + '\n');
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('GET ' + url + ' → ' + res.status);
  return res.json();
}
async function postJson(url, body, method) {
  const res = await fetch(url, {
    method: method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(method + ' ' + url + ' → ' + res.status + ': ' + (await res.text()));
  return res.json();
}

// 抽屉是滑入动画（anim-drawer）——截图前等动画落定（drive-chief-drawer 同律）。
const DRAWER = '.chief-drawer';
async function settled(page) {
  await page
    .locator(DRAWER)
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    .catch(() => {});
}

// #950 载体迁移：FAB = aria-label 总管 钮、composer = data-testid、头部 chip
// 标题 = aria-label 主题 钮内唯一 span（.chief-chip-title 类退役）。
const FAB = 'button[aria-label="总管"]';
const COMPOSER = '[data-testid="chief-composer-input"]';
const NEW_THREAD_BTN = DRAWER + ' button[aria-label="新主题"]';
const CHIP_BTN = DRAWER + ' button[aria-label="主题"]';
const CHIP_TITLE = CHIP_BTN + ' span';

const stamp = Date.now() % 100000;
const prov = {
  providerId: 'verify-gw-' + stamp,
  label: '验证网关' + stamp,
  baseUrl: 'https://gw.verify.example.com/v1',
  api: 'openai-completions',
  authHeader: true,
  models: [{ id: 'v-model-a-' + stamp, name: '验证模型A' + stamp }],
};

const extra = {};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 732 } });
const page = await context.newPage();

try {
  const teams = await getJson(SERVER + '/api/teams');
  const teamId = teams?.[0]?.id ?? null;
  check('api-team-ready', teamId != null, teamId != null ? 'teamId=' + teamId : '取 teamId 失败');

  // —— 作用域门（关态）：裸 N 不得开任何面 ——
  await page.goto(WEB + '/app');
  await page.waitForSelector(FAB, { timeout: 15000 });
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('n');
  await page.waitForTimeout(300);
  const closedCount = await page.locator(DRAWER).count();
  const dialogCount = await page.locator('.new-task-dialog').count();
  check(
    'closed-drawer-n-inert',
    closedCount === 0 && dialogCount === 0,
    '关态裸 N ×3：drawer=' + closedCount + ' dialog=' + dialogCount,
  );

  // —— 开抽屉：⌘J 和弦，焦点落 composer ——
  await page.keyboard.press('Control+j');
  await page.waitForSelector(DRAWER, { state: 'visible', timeout: 8000 });
  await settled(page);
  const composerFocused = await page
    .locator(COMPOSER)
    .evaluate((el) => el === document.activeElement);
  check('open-lands-composer-focus', composerFocused, composerFocused ? '焦点在 composer' : '焦点未落 composer');

  // —— 输入态守卫（触发不可观测态）：n 落进草稿，不是触发 ——
  await page.keyboard.press('n');
  const draftAfterGuard = await page.locator(COMPOSER).inputValue();
  const heroBeforeThread = await page.locator(DRAWER + ' [data-testid="chief-examples"]').isVisible().catch(() => false);
  check(
    'composer-focus-n-types',
    draftAfterGuard === 'n' && heroBeforeThread,
    '草稿=' + JSON.stringify(draftAfterGuard) + '；新主题视图在=' + heroBeforeThread,
  );
  await page.locator(COMPOSER).fill('');

  // —— 铺底：provider → agent → 绑定 chief（非被测路径）——
  if (teamId != null) {
    await postJson(SERVER + '/api/teams/' + teamId + '/providers', prov);
    const agentEnv = await postJson(SERVER + '/api/teams/' + teamId + '/agents', {
      displayName: 'verify-chief-n-' + stamp,
      description: '验证 #645 N 键绑定。',
      provider: prov.providerId,
      modelId: prov.models[0].id,
    });
    extra.agentId = agentEnv.id ?? agentEnv.agent?.id ?? null;
    await postJson(
      SERVER + '/api/teams/' + teamId + '/chief',
      { agent: { agentId: extra.agentId, thinkingLevel: null } },
      'PATCH',
    );
  }
  check('seed-bound', extra.agentId != null, extra.agentId != null ? 'agent=' + extra.agentId : '铺底绑定失败');

  // 铺底走 API，react-query 不知——重载取绑定态。
  await page.reload();
  await page.waitForSelector(FAB, { timeout: 15000 });
  await page.click(FAB);
  await page.waitForSelector(DRAWER, { state: 'visible', timeout: 8000 });
  await settled(page);

  // —— 建线程：composer 发送 → 线程视图落地 ——
  await page.locator(COMPOSER).fill('第一句建线程。');
  await page.keyboard.press('Enter');
  await page.waitForSelector(DRAWER + ' [data-testid="chief-stream"]', { state: 'visible', timeout: 8000 }).catch(() => {});
  const streamVisible = await page.locator(DRAWER + ' [data-testid="chief-stream"]').isVisible().catch(() => false);
  const chipInThread = ((await page.locator(CHIP_TITLE).textContent().catch(() => '')) ?? '').trim();
  check(
    'send-lands-thread-view',
    streamVisible && chipInThread !== '新主题',
    'stream 在=' + streamVisible + '；chip=' + chipInThread,
  );
  await settled(page);
  await shot(page, '01-before-n-thread-view.png');

  // —— 徽标：静息隐藏 / 悬浮浮出 N / aria-keyshortcuts ——
  const newThreadBtn = page.locator(NEW_THREAD_BTN);
  const hint = newThreadBtn.locator('.kbd-hint');
  const hintAtRest = await hint.isHidden().catch(() => false);
  await newThreadBtn.hover();
  // visibility 翻在过渡的第一帧（transition-[opacity,visibility]）——单次
  // isVisible 会读到 progress 0 的 hidden；waitFor 即 e2e expect 的重试律。
  const hintHoverVisible = await hint
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  const hintText = hintHoverVisible ? ((await hint.textContent()) ?? '').trim() : '';
  const ariaKey = await newThreadBtn.getAttribute('aria-keyshortcuts');
  check(
    'hint-and-aria',
    hintAtRest && hintHoverVisible && hintText === 'N' && ariaKey === 'N',
    '静息隐藏=' + hintAtRest + '；悬浮=' + hintText + '；aria-keyshortcuts=' + ariaKey,
  );
  await settled(page);
  await shot(page, '02-hint-hover.png');
  // 悬浮态离开（移去 body 空白），顺带为下一步 blur 铺路
  await page.mouse.move(10, 400);

  // —— 输入态守卫（触发可观测态）：线程视图下 composer 聚焦按 n = 打字 ——
  await page.locator(COMPOSER).click();
  await page.keyboard.press('n');
  const draftInThread = await page.locator(COMPOSER).inputValue();
  const streamStill = await page.locator(DRAWER + ' [data-testid="chief-stream"]').isVisible().catch(() => false);
  check(
    'thread-view-composer-n-types',
    draftInThread === 'n' && streamStill,
    '草稿=' + JSON.stringify(draftInThread) + '；stream 仍在=' + streamStill,
  );
  await page.locator(COMPOSER).fill('');
  await page.locator(COMPOSER).blur();

  // —— 触发：裸 N → 新主题视图（stream 收、hero 出、chip 回「新主题」）——
  await page.keyboard.press('n');
  await page.waitForSelector(DRAWER + ' [data-testid="chief-examples"]', { state: 'visible', timeout: 8000 }).catch(() => {});
  const heroAfter = await page.locator(DRAWER + ' [data-testid="chief-examples"]').isVisible().catch(() => false);
  const streamAfter = await page.locator(DRAWER + ' [data-testid="chief-stream"]').isVisible().catch(() => false);
  const chipAfter = ((await page.locator(CHIP_TITLE).textContent().catch(() => '')) ?? '').trim();
  check(
    'n-fires-new-thread-view',
    heroAfter && !streamAfter && chipAfter === '新主题',
    'hero=' + heroAfter + '；stream=' + streamAfter + '；chip=' + chipAfter,
  );
  await settled(page);
  await shot(page, '03-after-n-hero.png');

  // —— 触发与钮同语义：切换器 popover 开着时 N 一并收掉 ——
  // #950 载体：切换器开关 = 头部 chip 钮（aria-label 主题）；popover 本体 =
  // role=menu（.chief-switcher 类退役，非 portal、住抽屉 header 内）。
  await page.locator(CHIP_BTN).click();
  const popoverOpen = await page.locator(DRAWER + ' [role="menu"]').isVisible().catch(() => false);
  await page.keyboard.press('n');
  await page.waitForTimeout(300);
  const popoverAfter = await page.locator(DRAWER + ' [role="menu"]').count();
  check(
    'n-closes-switcher-popover',
    popoverOpen && popoverAfter === 0,
    '开 popover=' + popoverOpen + '；N 后 popover 数=' + popoverAfter,
  );

  // —— 作用域门（关态复验）：⌘J 收抽屉后裸 N 不再触发 ——
  await page.keyboard.press('Control+j');
  await page.waitForSelector(DRAWER, { state: 'hidden', timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('n');
  await page.waitForTimeout(300);
  const closedAgain = await page.locator(DRAWER).count();
  check('closed-again-n-inert', closedAgain === 0, '收抽屉后裸 N ×3：drawer=' + closedAgain);
} catch (err) {
  check('probe-exception', false, String(err?.message ?? err));
  try {
    await shot(page, '99-error.png');
  } catch {
    /* 截不上就算了 */
  }
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: 'chief-new-thread-key',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: stack.homeDir },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(
  '\nevidence: ' +
    EVIDENCE +
    '\nallOk=' +
    ok +
    '\n' +
    (ok
      ? 'drive chief-new-thread-key:PASS'
      : 'drive chief-new-thread-key:FAIL(' + checks.filter((c) => !c.ok).length + ' 项)') +
    '\n',
);
process.exit(ok ? 0 : 1);
