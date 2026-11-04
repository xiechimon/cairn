#!/usr/bin/env node

import { createRequire } from 'node:module';
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
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-chief-drawer');
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

async function settled(page) {
  await page
    .locator(DRAWER_SEL)
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    .catch(() => {});
}

const FAB = 'button[aria-label="总管"]';
const WAKE_FAB = '.secondary-fab';
const DRAWER = '.chief-drawer';
const DRAWER_SEL = '.chief-drawer';
const MODEL_BTN = 'button[aria-label="总管主模型"]';
const DIALOG = '[role="dialog"][aria-label="模型"]';
const GEAR = 'button[aria-label="总管设置"]';
const SETTINGS = 'h1:text-is("总管设置")';
const REWIND_DIALOG = '[role="dialog"][aria-label="恢复到此处"]';

const stamp = Date.now() % 100000;
const prov = {
  providerId: 'verify-gw-' + stamp,
  label: '验证网关' + stamp,
  baseUrl: 'https://gw.verify.example.com/v1',
  api: 'openai-completions',
  authHeader: true,
  models: [
    { id: 'v-model-a-' + stamp, name: '验证模型A' + stamp },
    { id: 'v-model-b-' + stamp, name: '验证模型B' + stamp },
  ],
};

const extra = {};
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
const page = await context.newPage();

function sqliteClearActiveRun(threadId) {
  if (threadId == null) return false;
  const require = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(join(stack.homeDir, 'server/server.db'));
  db.prepare('update chief_thread set activeRun = null where id = ?').run(threadId);
  db.close();
  return true;
}

function sqliteStepCount(threadId) {
  if (threadId == null) return -1;
  const require = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(join(stack.homeDir, 'server/server.db'), { readonly: true });
  const row = db.prepare('select count(*) as n from step where buildId = ?').get(threadId);
  db.close();
  return row ? row.n : -1;
}

function sqliteChiefModel() {
  const require = createRequire(join(REPO, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(join(stack.homeDir, 'server/server.db'), { readonly: true });
  const row = db.prepare('select model from chief limit 1').get();
  db.close();
  return row ? row.model : undefined;
}

try {
  const teams = await getJson(SERVER + '/api/teams');
  const teamId = teams?.[0]?.id ?? null;
  check('api-team-ready', teamId != null, teamId != null ? 'teamId=' + teamId : '取 teamId 失败');

  await page.goto(WEB + '/app/team');
  await page.waitForSelector(WAKE_FAB, { timeout: 15000 });
  await page.click(WAKE_FAB);
  await page.waitForSelector(DRAWER, { state: 'visible', timeout: 8000 });
  await settled(page);

  const gateBtn = page.locator(DRAWER + ' button:text-is("设置")');
  const gateVisible = await gateBtn.isVisible().catch(() => false);
  check('offboard-gate-rendered', gateVisible, gateVisible ? '非 board 门控条设置钮在' : '门控条设置钮缺失');
  if (gateVisible) {
    await gateBtn.click();
    await page
      .waitForSelector(SETTINGS, { state: 'visible', timeout: 8000 })
      .catch(() => {});

    const landed = await page.locator(SETTINGS).isVisible().catch(() => false);
    check(
      'offboard-gate-reaches-settings',
      landed,
      landed ? '落 board 设置视图（参已消费剥除）' : '点击门控条设置无落地（死钮）',
    );
    await shot(page, '01-offboard-settings.png');
  }

  if (teamId != null) {
    await postJson(SERVER + '/api/teams/' + teamId + '/providers', prov);
    const agentEnv = await postJson(SERVER + '/api/teams/' + teamId + '/agents', {
      displayName: 'verify-chief-agent-' + stamp,
      description: '验证总管绑定。',
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

  await page.goto(WEB + '/app');
  await page.waitForSelector(FAB, { timeout: 15000 });
  await page.click(FAB);
  await page.waitForSelector(DRAWER, { state: 'visible', timeout: 8000 });
  await settled(page);

  await page
    .waitForFunction(
      () => {
        const btn = document.querySelector('button[aria-label="总管主模型"]');
        return btn != null && btn.querySelector('span > svg') != null;
      },
      null,
      { timeout: 10000 },
    )
    .catch(() => {});
  const modelBtn = page.locator(MODEL_BTN);
  const btnVisible = await modelBtn.isVisible().catch(() => false);
  check(
    'model-row-is-control',
    btnVisible,
    btnVisible ? '模型行 = button[aria-haspopup=dialog]' : '模型行仍非控制件（纯显示）',
  );

  const markSvg = btnVisible ? await modelBtn.locator('> span:first-child svg').count() : 0;
  const markImg = btnVisible ? await modelBtn.locator('> span:first-child img').count() : 0;
  check(
    'model-row-carries-runtime-mark',
    markSvg === 1 && markImg === 0,
    markSvg === 1 && markImg === 0
      ? '行首 = 运行时标记（π svg，无头像 img）'
      : '行首标记 svg=' + markSvg + ' img=' + markImg,
  );
  await shot(page, '02-bound-model-row.png');

    await page.locator(DRAWER + ' header').screenshot({ path: join(EVIDENCE, '06-drawer-head.png') });
    artifacts.push('06-drawer-head.png');

  if (btnVisible) {
    await modelBtn.click();
    await page.waitForSelector(DIALOG, { state: 'visible', timeout: 8000 }).catch(() => {});
    const dialogVisible = await page.locator(DIALOG).isVisible().catch(() => false);
    const dialogText = dialogVisible ? await page.locator(DIALOG).textContent() : '';
    const hasModels = prov.models.every((m) => (dialogText ?? '').includes(m.name));
    const hasDefault = (dialogText ?? '').includes('默认（与绑定 Agent 相同）');
    check(
      'dialog-lists-provider-models',
      dialogVisible && hasModels && hasDefault,
      dialogVisible
        ? 'dialog 开；含铺底两模型=' + hasModels + '；含默认行=' + hasDefault
        : '模型 dialog 未开',
    );
    await shot(page, '03-model-dialog.png');

    const target = prov.models[1];
    await page.locator(DIALOG + ' [role="option"]', { hasText: target.name }).click();
    await page.waitForSelector(DIALOG, { state: 'detached', timeout: 8000 }).catch(() => {});
    await page
      .waitForFunction(
        (want) => {
          const btn = document.querySelector('button[aria-label="总管主模型"]');
          return btn != null && (btn.textContent ?? '').includes(want);
        },
        target.name,
        { timeout: 8000 },
      )
      .catch(() => {});
    const env = await getJson(SERVER + '/api/teams/' + teamId + '/chief');
    const apiModel = env?.chief?.model ?? null;
    const apiOk = apiModel != null && apiModel.provider === prov.providerId && apiModel.modelId === target.id;
    const rowLabel = (await page.locator(MODEL_BTN).textContent().catch(() => '')) ?? '';

    check(
      'pick-persists-and-echoes',
      apiOk && rowLabel.includes(target.id),
      'GET chief.model=' +
        JSON.stringify(apiModel) +
        '；行回显含=' +
        rowLabel.includes(target.name) +
        '（' +
        rowLabel.trim() +
        '）',
    );
    const sqlRaw = sqliteChiefModel();
    let sqlOk = false;
    try {
      const sqlVal = typeof sqlRaw === 'string' ? JSON.parse(sqlRaw) : sqlRaw;
      sqlOk = sqlVal != null && sqlVal.provider === prov.providerId && sqlVal.modelId === target.id;
    } catch {
      sqlOk = false;
    }
    check('sqlite-row-holds-override', sqlOk, 'chief.model 行=' + String(sqlRaw));
    await shot(page, '04-after-pick.png');

    await page.reload();
    await page.waitForSelector(FAB, { timeout: 15000 });
    await page.click(FAB);
    await page.waitForSelector(MODEL_BTN, { state: 'visible', timeout: 8000 }).catch(() => {});
    await settled(page);
    const reloaded = (await page.locator(MODEL_BTN).textContent().catch(() => '')) ?? '';
    check('reload-echo', reloaded.includes(target.id), '重载后行=' + reloaded.trim());

    await page.locator(MODEL_BTN).click();
    await page.waitForSelector(DIALOG, { state: 'visible', timeout: 8000 }).catch(() => {});
    await page
      .locator(DIALOG + ' [role="option"]', { hasText: '默认（与绑定 Agent 相同）' })
      .click();
    await page
      .waitForFunction(
        (agentModel) => {
          const btn = document.querySelector('button[aria-label="总管主模型"]');
          return btn != null && (btn.textContent ?? '').includes(agentModel + ' · 默认');
        },
        prov.models[0].id,
        { timeout: 8000 },
      )
      .catch(() => {});
    const env2 = await getJson(SERVER + '/api/teams/' + teamId + '/chief');
    const clearedOk = env2?.chief?.model === null;
    const label2 = (await page.locator(MODEL_BTN).textContent().catch(() => '')) ?? '';
    check(
      'default-row-clears-to-inherit',
      clearedOk && label2.includes('· 默认'),
      'GET chief.model=' +
        JSON.stringify(env2?.chief?.model === undefined ? 'missing' : env2.chief.model) +
        '；行=' +
        label2.trim(),
    );
  }

  await page.locator('[data-testid="chief-composer-input"]').fill('验证复制钮的一句话。');
  await page.keyboard.press('Enter');
  await page.waitForSelector(DRAWER + ' [data-testid="chief-msg-tools"] button[aria-label="复制"]', {
    state: 'visible',
    timeout: 8000,
  }).catch(() => {});
  const copyBtn = page.locator(DRAWER + ' [data-testid="chief-msg-tools"] button[aria-label="复制"]');
  const copyVisible = await copyBtn.isVisible().catch(() => false);
  if (copyVisible) {
    await copyBtn.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('copy-button-writes-clipboard', clip === '验证复制钮的一句话。', '剪贴板读回=' + JSON.stringify(clip));
  } else {
    check('copy-button-writes-clipboard', false, '消息行复制钮缺失（仍裸 glyph）');
  }
  await settled(page);

  await page.locator('[data-testid="chief-composer-input"]').fill('第二句供 rewind。');
  await page.keyboard.press('Enter');
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="chief-msg-tools"] button[aria-label="恢复到此处"]')
          .length >= 2,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  const restoreBtns = page.locator(
    DRAWER + ' [data-testid="chief-msg-tools"] button[aria-label="恢复到此处"]',
  );
  const nRestore = await restoreBtns.count();
  const threadsPre = await getJson(SERVER + '/api/teams/' + teamId + '/chief/threads');
  sqliteClearActiveRun(threadsPre?.[0]?.id ?? null);
  if (nRestore >= 2) {
    await restoreBtns.first().click();

    await page.waitForSelector(REWIND_DIALOG, { state: 'visible', timeout: 8000 }).catch(() => {});
    await page.locator(REWIND_DIALOG + ' button:has-text("恢复到此处")').click();
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="chief-msg-tools"] button[aria-label="恢复到此处"]')
            .length === 1,
        null,
        { timeout: 8000 },
      )
      .catch(() => {});
    const threads = await getJson(SERVER + '/api/teams/' + teamId + '/chief/threads');
    const tid = threads?.[0]?.id ?? null;
    let userMsgs = [];
    if (tid != null) {
      const conv = await getJson(SERVER + '/api/conversations/' + tid + '/messages');
      userMsgs = (conv.messages ?? []).filter((m) => m.role === 'user');
    }
    const sqlSteps = sqliteStepCount(tid);
    check(
      'rewind-truncates-and-reenqueues',
      userMsgs.length === 1 &&
        userMsgs[0].content === '验证复制钮的一句话。' &&
        sqlSteps === 3,
      'user 消息=' + userMsgs.length + '（锚保留）；step 行=' + sqlSteps + '（A+B+rewind）',
    );
  } else {
    check('rewind-truncates-and-reenqueues', false, '恢复钮数=' + nRestore + '（应 ≥2）');
  }
  await shot(page, '07-after-rewind.png');

  await settled(page);
  const bareTools = await page.locator(DRAWER + ' [data-testid="chief-msg-tools"] > svg').count();
  const bareFoot = await page.locator(DRAWER + ' [data-testid="chief-msg-foot"] > svg').count();
  check('dead-glyphs-removed', bareTools === 0 && bareFoot === 0, '裸 svg：tools=' + bareTools + ' foot=' + bareFoot);
  await shot(page, '05-copy-feedback.png');
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
  probe: 'chief-drawer',
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
    (ok ? 'drive chief-drawer:PASS' : 'drive chief-drawer:FAIL(' + checks.filter((c) => !c.ok).length + ' 项)') +
    '\n',
);
process.exit(ok ? 0 : 1);
