#!/usr/bin/env node

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

const DRAWER = '.chief-drawer';
async function settled(page) {
  await page
    .locator(DRAWER)
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    .catch(() => {});
}

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

  await page.keyboard.press('Control+j');
  await page.waitForSelector(DRAWER, { state: 'visible', timeout: 8000 });
  await settled(page);
  const composerFocused = await page
    .locator(COMPOSER)
    .evaluate((el) => el === document.activeElement);
  check('open-lands-composer-focus', composerFocused, composerFocused ? '焦点在 composer' : '焦点未落 composer');

  await page.keyboard.press('n');
  const draftAfterGuard = await page.locator(COMPOSER).inputValue();
  const heroBeforeThread = await page.locator(DRAWER + ' [data-testid="chief-examples"]').isVisible().catch(() => false);
  check(
    'composer-focus-n-types',
    draftAfterGuard === 'n' && heroBeforeThread,
    '草稿=' + JSON.stringify(draftAfterGuard) + '；新主题视图在=' + heroBeforeThread,
  );
  await page.locator(COMPOSER).fill('');

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

  await page.reload();
  await page.waitForSelector(FAB, { timeout: 15000 });
  await page.click(FAB);
  await page.waitForSelector(DRAWER, { state: 'visible', timeout: 8000 });
  await settled(page);

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

  const newThreadBtn = page.locator(NEW_THREAD_BTN);
  const hint = newThreadBtn.locator('.kbd-hint');
  const hintAtRest = await hint.isHidden().catch(() => false);
  await newThreadBtn.hover();

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

  await page.mouse.move(10, 400);

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
