#!/usr/bin/env node
// verify-pacman drive-providers-tabs — providers 页 runtime tabs 全链
// （spec 11 A1-A4/A7，#353；先行地图 #354）。
//
// 真用户路径：/app/resources/providers → runtime tablist（pi / Claude Code）
// → pi 空态引导钮开 picker → API 铺底 custom provider 后 pi tab 出模型行
// → 切 Claude Code tab（?runtime= 同步）→ header 卡安装态 → 深链直落。
//
// 真值：GET /api/teams/:id/model-sources 封套（sources[] = runtime/installed/
// hostname/models）与 UI header 卡、模型行双真值一致；铺底走公开 REST
// POST /api/teams/:id/providers（非被测路径，同 drive.mjs search probe 铺底律）。
// 负向（A1/A7）：页面无「Pacman（内置）」facade 行；行无 chevron/三点装饰。
//
// 先行地图语义（A12）：spec 11 实现票（model-sources 端点 + providers 页
// 重写）落地前本 probe 为红——每条 FAIL detail 指向 spec 条款，红态输出即
// 实现票的验收清单，不是 harness 故障。
//
// 依赖全新库（pi 空态断言，同 api-key probe 律）：先于 drive-provider-picker
// .mjs 跑；重验 = 重 launch。claude-code 段数据源 = 执行机上报（#707，A4 修订）：
// probe 经公开 machine wire 自铺底一台上报过的机器（建 API key → enroll 携
// claudeCode 上报，无需真 daemon），断言 UI=API=上报值三方一致。
// #944 载体迁移：类名钩 → 语义/data-* 载体，断言语义不变——.res-runtime-empty →
// [data-testid="runtime-empty"]、.res-model-row → [data-model-id][data-runtime]、
// .res-runtime-head → [data-testid="runtime-head"]、.dlg-picker-search →
// input[aria-label="搜索服务商..."]、.res-row-chev/-more 负向 → 行内 svg/button
// 计数 0；.page-main = 页面壳 sheet（PR 6 三壳合一）。
// 用法：node drive-providers-tabs.mjs

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
  // 断言位必须真是 boolean（drive-tags 同律）——写反会恒真。
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
/** 软 GET：端点未实现（404 等）不抛，返回 { ok:false, error } 供 FAIL detail。 */
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

// 软断言原语：先行 probe 的红态要逐条产出 FAIL detail（不是首个超时即中止），
// 所有 selector 探测一律不抛。
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
  // 0) 页面就绪 + teamId（API 真值坐标）
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

  // 0b) #707 执行机铺底：建 API key → enroll 携 claudeCode 上报（公开 machine
  // wire，无需真 daemon）。上报值钉死，与本机真实 settings.json 无关。
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
  // 上报后重载页面，使 model-sources 查询拿到含执行机段的封套。
  await page.reload();
  await page.waitForSelector(SHELL, { timeout: 15_000 }).catch(() => {});

  // 1) A1：runtime tablist = 恰 pi / Claude Code 两 tab，默认 pi，无「内置」字样
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

  // 2) A1 负向：「Pacman（内置）」facade 行已除（非空守卫：读不到正文时负向不可判真）
  const bodyText = await softText(page, `${SHELL} .page-main`);
  const facadeGone = bodyText !== '' && !bodyText.includes('Pacman（内置）');
  check(
    'no-builtin-facade',
    facadeGone,
    bodyText === ''
      ? '页面正文不可读（.page-main 缺失？）——负向断言不可空判'
      : facadeGone
        ? '页面无「Pacman（内置）」facade 行'
        : 'spec 11 A1：「Pacman（内置）」facade 行仍在（前端静态装饰行未除）',
  );

  // 3) A3：全新库 → pi 空态 + 引导钮开 picker
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

  // 4) 铺底：API POST custom provider（非被测路径）→ pi tab 应投影其 models[]
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

  // #944 载体迁移：.res-model-row 类名钩 → [data-model-id][data-runtime]
  // 契约句柄（providers-tabs.spec 同锚）。
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

  // 5) A2/A7 负向：纯展示行无可点感装饰（#944 载体迁移：.res-row-chev/-more
  //    装饰类退役——断言改钉「行内零 svg 零 button」，providers-tabs.spec 同 canon）。
  const chevCount = await softCount(page, `${SHELL} [data-model-id] svg`);
  const moreCount = await softCount(page, `${SHELL} [data-model-id] button`);
  check(
    'rows-no-affordance',
    chevCount === 0 && moreCount === 0,
    `spec 11 A7：无 handler 行不渲染 chevron/三点（行内 svg/button 计数 0）——实测 svg ${chevCount} 个 / button ${moreCount} 个`,
  );

  // 6) A1：切 Claude Code tab → aria-selected 翻转 + ?runtime= 同步
  // #423 修正探针竞态（断言语义不变，两条件并收进同一次有界轮询）：data
  // router（react-router v7 createBrowserRouter）把路由态更新包在
  // startTransition 里，history.push 恒先于 React commit 一拍——「先等 URL、
  // 再单读 aria-selected」读到的是 commit 前旧值（旧 DOM 树 commit 快，曾靠
  // 时序侥幸过关；shadcn Tabs 迁移后 commit 变长即翻车，实测 0–50ms 窗口）。
  // e2e providers-tabs.spec 用自动重试断言，无此面。
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

  // 7) 数据契约（#707）：GET model-sources = pi 首段 + 每台上报过的机器一段
  // claude-code（序固定：pi 首 + 按机器名）
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
  // #707 F1：段值 = 执行机上报值（非 server 本机配置）——hostname 与模型双钉。
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
  // 封套元素形状（机器无关，可钉死）：{runtime, installed, hostname, models[{id,name,slot?}]}
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

  // 8) A2/A4（#707）：执行机 header 卡——上报过的机器各一张，文案为上报 hostname
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

  // 9) UI=API 一致性：claude-code 可见模型行数 = 各段 models 长度之和，且上报
  // 模型行在位（data-model-id 钉死上报值）
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

  // 10) A1：深链 ?runtime=claude-code 直落对应 tab
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
    /* 截不上就算了 */
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
