#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const portsFile = join(RUN_DIR, 'ports.json');
if (!existsSync(portsFile)) {
  process.stderr.write(`无栈：${portsFile} 不存在或损坏。先跑 launch.mjs\n`);
  process.exit(1);
}
const stack = JSON.parse(readFileSync(portsFile, 'utf8'));
const SERVER = `http://127.0.0.1:${stack.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${stack.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-providers-tabs`);
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

const tryGetJson = async (url) => {
  try {
    return { ok: true, data: await getJson(url) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
};
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
};
const postAuthedJson = async (url, bearer, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
};

const softVisible = async (page, selector, timeout = 5000) =>
  page
    .waitForSelector(selector, { state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
const softCount = async (page, selector) => page.locator(selector).count().catch(() => 0);
const softText = async (page, selector) =>
  page
    .locator(selector)
    .first()
    .innerText()
    .catch(() => '');
const oneLine = (s) => (s ?? '').replace(/\s*\n\s*/g, ' / ').slice(0, 200);

const PAGE_PATH = '/app/resources/providers';
const SHELL = `[data-route="${PAGE_PATH}"]`;
const HOST = hostname();
const extra = { hostname: HOST };
const EXEC_HOST = 'verify-exec-1';

const stamp = Date.now() % 100000;
const seedProvider = {
  providerId: `verify-gw-${stamp}`,
  label: `验证网关${stamp}`,
  baseUrl: 'https://gw.verify.example.com/v1',
  api: 'openai-completions',
  authHeader: true,
  models: [
    { id: `verify-model-a-${stamp}`, name: `验证模型A-${stamp}` },
    { id: `verify-model-b-${stamp}`, name: `验证模型B-${stamp}` },
  ],
};
extra.seedProvider = seedProvider;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {

  await page.goto(`${WEB}${PAGE_PATH}`);
  const shellReady = await softVisible(page, SHELL, 15_000);
  check('page-ready', shellReady, shellReady ? `${PAGE_PATH} shell 就绪` : '页面 shell 未渲染');
  await shot(page, '01-providers-arrival.png');

  const teamsRes = await tryGetJson(`${SERVER}/api/teams`);
  const teamId = teamsRes.ok ? (teamsRes.data?.[0]?.id ?? null) : null;
  check(
    'api-team-ready',
    teamId != null,
    teamId != null ? `GET /api/teams 取到 teamId=${teamId}` : `取 teamId 失败：${teamsRes.error}`,
  );

  const ccModelId = `verify-cc-model-${stamp}`;
  let enrolled = false;
  let enrollError = '无 teamId';
  if (teamId != null) {
    try {
      const keyRes = await postJson(`${SERVER}/api/teams/${teamId}/api-keys`, {
        name: `verify-707-${stamp}`,
        gitAccess: false,
        mcpAccess: false,
        toolGrants: { read: [], write: [] },
      });
      const apiKey = keyRes.plaintext;
      if (typeof apiKey !== 'string' || apiKey === '') throw new Error('api-keys 响应缺 plaintext');
      await postAuthedJson(`${SERVER}/api/machine/enroll`, apiKey, {
        teamId,
        name: 'verify-exec-1',
        cliVersion: '0.1.0-verify',
        claudeCode: {
          installed: true,
          hostname: EXEC_HOST,
          models: [{ id: ccModelId, name: ccModelId, slot: 'default' }],
        },
      });
      enrolled = true;
    } catch (err) {
      enrollError = String(err?.message ?? err);
    }
  }
  check(
    'enroll-executor-api',
    enrolled,
    enrolled
      ? `执行机 verify-exec-1 enroll 携上报（hostname=${EXEC_HOST}，模型 ${ccModelId}）`
      : `#707 铺底失败：${enrollError}`,
  );
  extra.ccModelId = ccModelId;

  await page.reload();
  await page.waitForSelector(SHELL, { timeout: 15_000 }).catch(() => {});

  const tablistOk = await softVisible(page, `${SHELL} [role="tablist"]`);
  check(
    'tablist-present',
    tablistOk,
    tablistOk
      ? 'runtime tablist 在位'
      : 'spec 11 A1：providers 页应为 runtime tablist（pi / Claude Code）——页面仍是旧列表形',
  );
  const tabInfo = await page
    .evaluate((shellSel) => {
      const shell = document.querySelector(shellSel);
      if (shell == null) return [];
      return [...shell.querySelectorAll('[role="tab"]')].map((el) => ({
        runtime: el.getAttribute('data-runtime'),
        text: (el.textContent ?? '').trim(),
        selected: el.getAttribute('aria-selected') === 'true',
      }));
    }, SHELL)
    .catch(() => []);
  const piTab = tabInfo.find((t) => t.runtime === 'pi');
  const ccTab = tabInfo.find((t) => t.runtime === 'claude-code');
  check(
    'tabs-pi-claude-code',
    tabInfo.length === 2 && piTab != null && ccTab != null,
    `spec 11 A1：恰两个 tab（data-runtime= pi / claude-code，无 Codex）——实测 ${tabInfo.length} 个：${
      tabInfo.map((t) => `${t.runtime ?? '?'}="${t.text}"`).join(', ') || '无 role=tab'
    }`,
  );
  check(
    'tab-labels',
    piTab?.text === 'pi' && ccTab?.text === 'Claude Code',
    `tab 文案应为 pi / Claude Code——实测 "${piTab?.text ?? '缺'}" / "${ccTab?.text ?? '缺'}"`,
  );
  check(
    'default-tab-pi',
    piTab?.selected === true,
    `默认选中 pi tab——aria-selected=${piTab?.selected ?? 'tab 缺失'}`,
  );

  const bodyText = await softText(page, `${SHELL} .page-main`);
  const facadeGone = bodyText !== '' && !bodyText.includes('Cairn（内置）');
  check(
    'no-builtin-facade',
    facadeGone,
    bodyText === ''
      ? '页面正文不可读（.page-main 缺失？）——负向断言不可空判'
      : facadeGone
        ? '页面无「Cairn（内置）」facade 行'
        : 'spec 11 A1：「Cairn（内置）」facade 行仍在（前端静态装饰行未除）',
  );

  const emptyOk = await softVisible(page, `${SHELL} [data-testid="runtime-empty"]`);
  check(
    'pi-empty-state',
    emptyOk,
    emptyOk
      ? 'pi tab 空态在位（全新库无 custom provider）'
      : 'spec 11 A3：pi tab 无 custom provider 时应渲染空态引导（[data-testid="runtime-empty"]）——未实现',
  );
  await shot(page, '02-pi-empty.png');
  let pickerOpened = false;
  if (emptyOk) {
    await page
      .locator(`${SHELL} [data-testid="runtime-empty"] button, ${SHELL} [data-testid="runtime-empty"] a`)
      .first()
      .click()
      .catch(() => {});
    pickerOpened = await softVisible(page, '[role="dialog"] input[aria-label="搜索服务商..."]');
    if (pickerOpened) {
      await page.click('[role="dialog"] button[aria-label="关闭"]').catch(() => {});
      await page
        .waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 5000 })
        .catch(() => {});
    }
  }
  check(
    'empty-opens-picker',
    pickerOpened,
    pickerOpened
      ? '空态引导钮开添加服务商 picker（搜索框在位）'
      : `spec 11 A3：空态引导应开添加服务商 picker${emptyOk ? '——dialog/搜索框未出现' : '（前置空态缺失）'}`,
  );

  let seeded = false;
  let seedError = '无 teamId';
  if (teamId != null) {
    try {
      await postJson(`${SERVER}/api/teams/${teamId}/providers`, seedProvider);
      seeded = true;
    } catch (err) {
      seedError = String(err?.message ?? err);
    }
  }
  check(
    'seed-provider-api',
    seeded,
    seeded
      ? `POST providers 铺底 ${seedProvider.providerId}（${seedProvider.models.length} 模型）`
      : `铺底 POST /api/teams/:id/providers 失败：${seedError}`,
  );
  await page.reload();
  await page.waitForSelector(SHELL, { timeout: 15_000 }).catch(() => {});

  const rowSelA = `${SHELL} [data-model-id="${seedProvider.models[0].id}"][data-runtime="pi"]`;
  const rowSelB = `${SHELL} [data-model-id="${seedProvider.models[1].id}"][data-runtime="pi"]`;
  const rowsOk = (await softVisible(page, rowSelA)) && (await softVisible(page, rowSelB));
  const rowAText = rowsOk ? await softText(page, rowSelA) : '';
  check(
    'pi-model-rows',
    rowsOk && rowAText.includes(seedProvider.models[0].name),
    rowsOk
      ? `pi tab 模型行命中铺底两模型，行文本含显示名（"${oneLine(rowAText)}"）`
      : 'spec 11 A2/A3：pi tab 应渲染 custom provider models[] 的模型行（[data-model-id][data-runtime="pi"]，显示名 → 模型 id）——未命中',
  );
  await shot(page, '03-pi-model-rows.png');

  const chevCount = await softCount(page, `${SHELL} [data-model-id] svg`);
  const moreCount = await softCount(page, `${SHELL} [data-model-id] button`);
  check(
    'rows-no-affordance',
    chevCount === 0 && moreCount === 0,
    `spec 11 A7：无 handler 行不渲染 chevron/三点（行内 svg/button 计数 0）——实测 svg ${chevCount} 个 / button ${moreCount} 个`,
  );

  let switched = false;
  if (ccTab != null) {
    await page
      .click(`${SHELL} [role="tab"][data-runtime="claude-code"]`)
      .catch(() => {});
    switched = await page
      .waitForFunction(
        (sel) =>
          new URL(window.location.href).searchParams.get('runtime') === 'claude-code' &&
          document.querySelector(sel)?.getAttribute('aria-selected') === 'true',
        `${SHELL} [role="tab"][data-runtime="claude-code"]`,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
  }
  check(
    'tab-switch-url',
    switched,
    switched
      ? '切 Claude Code tab：aria-selected 翻转 + URL ?runtime=claude-code'
      : 'spec 11 A1：tab 切换应同步 ?runtime= search param（刷新/分享可回定位）——未达成',
  );

  const msRes =
    teamId != null
      ? await tryGetJson(`${SERVER}/api/teams/${teamId}/model-sources`)
      : { ok: false, error: '无 teamId' };
  check(
    'model-sources-api',
    msRes.ok === true,
    msRes.ok
      ? 'GET /api/teams/:id/model-sources 200'
      : `spec 11 数据契约：GET /api/teams/:id/model-sources 应 200——实测 ${msRes.error}`,
  );
  const sources = msRes.ok && Array.isArray(msRes.data?.sources) ? msRes.data.sources : [];
  const ccSegs = sources.filter((s) => s.runtime === 'claude-code');
  const execSeg = ccSegs.find((s) => s.hostname === EXEC_HOST);
  check(
    'model-sources-per-machine',
    sources.length >= 1 &&
      sources[0]?.runtime === 'pi' &&
      execSeg != null,
    `#707 契约：pi 首段 + 上报过的执行机各一段——实测 [${sources
      .map((s) => `${s.runtime}@${s.hostname}`)
      .join(', ') || '空'}]`,
  );

  const followsExecutor =
    execSeg != null &&
    execSeg.installed === true &&
    Array.isArray(execSeg.models) &&
    execSeg.models.some((m) => m?.id === ccModelId);
  check(
    'executor-following',
    followsExecutor,
    followsExecutor
      ? `claude-code 段跟随执行机：hostname=${EXEC_HOST}，模型含上报值 ${ccModelId}`
      : `#707 F1：claude-code 段应为执行机上报值——实测段 ${JSON.stringify(execSeg)?.slice(0, 160) ?? '缺席'}`,
  );

  const shapeOk =
    sources.length >= 1 &&
    sources.every(
      (s) =>
        typeof s.runtime === 'string' &&
        typeof s.installed === 'boolean' &&
        typeof s.hostname === 'string' &&
        Array.isArray(s.models) &&
        s.models.every(
          (m) =>
            typeof m?.id === 'string' &&
            m.id !== '' &&
            typeof m?.name === 'string' &&
            m.name !== '' &&
            (m.slot === undefined || typeof m.slot === 'string'),
        ),
    );
  check(
    'model-sources-shape',
    shapeOk,
    shapeOk
      ? '封套形状：runtime/installed/hostname + models[]{id,name,slot?} 逐段在位'
      : `spec 11 数据契约：sources 元素应为 {runtime,installed,hostname,models[{id,name,slot?}]}——实测 ${JSON.stringify(sources).slice(0, 160)}`,
  );
  extra.modelSources = sources;

  const headSel = `${SHELL} [data-testid="runtime-head"][data-runtime="claude-code"]`;
  const headCount = await softCount(page, headSel);
  const headTexts = headCount > 0 ? await softText(page, headSel) : '';
  const headPass =
    headCount === ccSegs.length && ccSegs.length > 0 && headTexts.includes(EXEC_HOST);
  check(
    'cc-header-card',
    headPass,
    headPass
      ? `header 卡按机器分段：${headCount} 张，含上报 hostname「已安装在 ${EXEC_HOST}」`
      : `#707：claude-code tab 应按上报机器分段渲染 header 卡（API ${ccSegs.length} 段，UI ${headCount} 张）——实测 "${oneLine(headTexts)}"`,
  );
  await shot(page, '04-cc-header.png');

  const ccApiModels = ccSegs.reduce(
    (n, seg) => n + (Array.isArray(seg.models) ? seg.models.length : 0),
    0,
  );
  const ccUiRows = await softCount(
    page,
    `${SHELL} [data-model-id][data-runtime="claude-code"]:visible`,
  );
  const reportedRowOk = await softVisible(
    page,
    `${SHELL} [data-model-id="${ccModelId}"][data-runtime="claude-code"]`,
  );
  check(
    'cc-model-rows-consistency',
    ccUiRows === ccApiModels && reportedRowOk,
    `claude-code 模型行 UI=${ccUiRows} vs API=${ccApiModels}，上报行 ${ccModelId} ${reportedRowOk ? '在位' : '缺失'}`,
  );
  await shot(page, '05-cc-tab.png');

  await page.goto(`${WEB}${PAGE_PATH}?runtime=claude-code`);
  await page.waitForSelector(SHELL, { timeout: 15_000 }).catch(() => {});
  const deepSelected = await page
    .evaluate(
      (sel) => document.querySelector(sel)?.getAttribute('aria-selected') === 'true',
      `${SHELL} [role="tab"][data-runtime="claude-code"]`,
    )
    .catch(() => false);
  check(
    'deep-link-runtime',
    deepSelected,
    deepSelected
      ? '深链 ?runtime=claude-code 直落 Claude Code tab'
      : 'spec 11 A1：?runtime= 深链应回定位到对应 tab——未达成',
  );
  await shot(page, '06-deep-link.png');
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
  probe: 'providers-tabs',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: stack.homeDir },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive providers-tabs:PASS' : `drive providers-tabs:FAIL(${checks.filter((c) => !c.ok).length} 项)`}\n`,
);
process.exit(ok ? 0 : 1);
