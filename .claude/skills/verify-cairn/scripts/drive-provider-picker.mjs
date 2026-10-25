#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
const DB_PATH = join(stack.homeDir ?? join(RUN_DIR, 'home'), 'server', 'server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-provider-picker`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const PRESET_NAMES = {

  'github-copilot': 'GitHub Copilot',
  'openai-codex': 'OpenAI Codex',
  xai: 'xAI',
  'amazon-bedrock': 'Amazon Bedrock',
  'ant-ling': 'Ant Ling',
  anthropic: 'Anthropic',
  baseten: 'Baseten',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  google: 'Google',
  'google-vertex': 'Google Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi For Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  mistral: 'Mistral',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI CN',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  'qwen-token-plan': 'Qwen Token Plan',
  'qwen-token-plan-cn': 'Qwen Token Plan CN',
  'qwen-token-plan-individual': 'Qwen Token Plan Individual',
  together: 'Together',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xiaomi: 'Xiaomi',
  'xiaomi-token-plan-ams': 'Xiaomi Token Plan AMS',
  'xiaomi-token-plan-cn': 'Xiaomi Token Plan CN',
  'xiaomi-token-plan-sgp': 'Xiaomi Token Plan SGP',
  'z-ai': 'Z.AI',
  'z-ai-coding-cn': 'Z.AI Coding CN',
};
const PRESET_IDS = Object.keys(PRESET_NAMES);
if (PRESET_IDS.length !== 38) {

  process.stderr.write(`PRESET_NAMES 应恰 38 项，实际 ${PRESET_IDS.length}\n`);
  process.exit(2);
}

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

const dbQuery = (fn) => {
  try {
    const Database = require2('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      return { ok: true, ...fn(db) };
    } finally {
      db.close();
    }
  } catch (err) {
    return { ok: false, skipped: true, reason: String(err?.message ?? err) };
  }
};

const softVisible = async (page, selector, timeout = 5000) =>
  page
    .waitForSelector(selector, { state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
const softHidden = async (page, selector, timeout = 5000) =>
  page
    .waitForSelector(selector, { state: 'hidden', timeout })
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
const DLG = '[role="dialog"]';
const ROW = `${DLG} [data-preset-id]`;
const ROW_VISIBLE = `${ROW}:visible`;
const extra = {};

const stamp = Date.now() % 100000;
const newProvider = {
  providerId: `verify-pick-${stamp}`,
  label: `拣选网关${stamp}`,
  baseUrl: 'https://pick.verify.example.com/v1',
  modelId: `pick-model-${stamp}`,
};
extra.newProvider = newProvider;

const visibleRowIds = async (page) =>
  page
    .locator(ROW_VISIBLE)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-preset-id')))
    .catch(() => []);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

try {

  await page.goto(`${WEB}${PAGE_PATH}`);
  const shellReady = await softVisible(page, SHELL, 15_000);
  check('page-ready', shellReady, shellReady ? `${PAGE_PATH} shell 就绪` : '页面 shell 未渲染');

  const teamsRes = await tryGetJson(`${SERVER}/api/teams`);
  const teamId = teamsRes.ok ? (teamsRes.data?.[0]?.id ?? null) : null;
  check(
    'api-team-ready',
    teamId != null,
    teamId != null ? `GET /api/teams 取到 teamId=${teamId}` : `取 teamId 失败：${teamsRes.error}`,
  );

  const pageText = await softText(page, `${SHELL} .page-main`);
  const leaked = ['DeepSeek', 'OpenRouter', 'Cloudflare AI Gateway'].filter((n) =>
    pageText.includes(n),
  );
  check(
    'page-no-presets',
    pageText !== '' && leaked.length === 0,
    pageText === ''
      ? '页面正文不可读（.page-main 缺失？）——负向断言不可空判'
      : leaked.length === 0
        ? '页面无 preset 名投喂（preset 仅在 dialog 内出现）'
        : `spec 11 A5：preset 仅在 dialog 内出现——页面泄漏 ${leaked.join(', ')}`,
  );

  await page.click(`${SHELL} [data-testid="resource-new"]`).catch(() => {});
  const dlgOk = await softVisible(page, DLG);
  check(
    'new-opens-dialog',
    dlgOk,
    dlgOk ? '「新建」开添加服务商 dialog' : '[data-testid="resource-new"] 点击后 [role=dialog] 未出现',
  );
  await shot(page, '01-dialog-open.png');

  const searchOk = dlgOk && (await softVisible(page, `${DLG} input[aria-label="搜索服务商..."]`));
  check(
    'picker-search-present',
    searchOk === true,
    searchOk
      ? 'picker 搜索框在位（input[aria-label="搜索服务商..."]）'
      : 'spec 11 A6：dialog 应为 picker 形态，顶部搜索框（input[aria-label="搜索服务商..."]）——未实现（现状为自定义网关表单直陈）',
  );

  const rowCount = dlgOk ? await softCount(page, ROW) : 0;
  check(
    'preset-rows-38',
    rowCount === 38,
    rowCount === 38
      ? 'preset 行 38 项在位（[data-preset-id]）'
      : `spec 11 A5/A6：dialog 内应渲染 38 项 preset 行——实测 ${rowCount} 项`,
  );

  const rowData = await page
    .locator(ROW)
    .evaluateAll((els) =>
      Object.fromEntries(
        els.map((el) => [
          el.getAttribute('data-preset-id'),
          {
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            nodes: [el, ...el.querySelectorAll('*')]
              .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
              .filter((s) => s !== ''),
          },
        ]),
      ),
    )
    .catch(() => ({}));
  const rowTexts = Object.fromEntries(
    Object.entries(rowData).map(([id, v]) => [id, v.text]),
  );
  const missingNames = PRESET_IDS.filter(
    (id) => !(rowData[id]?.nodes ?? []).includes(PRESET_NAMES[id]),
  );
  check(
    'preset-names-canon',
    missingNames.length === 0,
    missingNames.length === 0
      ? '38 项显示名与 spec 11 名单逐字一致（名称节点等值）'
      : `spec 11 名单：preset 行显示名等值命中 ${38 - missingNames.length}/38——缺 ${missingNames
          .slice(0, 4)
          .map((id) => `${id}("${PRESET_NAMES[id]}")`)
          .join(', ')}${missingNames.length > 4 ? ` 等 ${missingNames.length} 项` : ''}`,
  );

  const hasOauthTag = (id) => (rowData[id]?.nodes ?? []).includes('OAuth');
  const ghOk = hasOauthTag('github-copilot');
  const codexText = rowTexts['openai-codex'] ?? '';
  const codexClean = codexText !== '' && !hasOauthTag('openai-codex');
  const codexNote = codexText.includes('暂未开通');
  const codexDisabled = await page
    .locator(`${ROW}[data-preset-id="openai-codex"]`)
    .isDisabled()
    .catch(() => false);
  const xaiClean = rowTexts['xai'] != null && !hasOauthTag('xai');
  check(
    'oauth-badge-wired-only',
    ghOk && codexClean && codexNote && codexDisabled && xaiClean,
    `spec 11 A6 + #385：「OAuth」标签仅 github-copilot=${ghOk}；openai-codex 未接线——无标签=${codexClean} 「暂未开通」注记=${codexNote} 行禁用=${codexDisabled}；xai 行不带标签=${xaiClean}`,
  );
  await shot(page, '02-preset-rows.png');

  let filterDetail = '搜索框缺失，过滤无从验证';
  let filtersOk = false;
  if (searchOk) {

    const searchInput = page
      .locator(`${DLG} input[aria-label="搜索服务商..."]`)
      .first();
    await searchInput.fill('qwen').catch(() => {});
    await page.waitForTimeout(300);
    const qwenIds = await visibleRowIds(page);
    const qwenOk =
      qwenIds.length === 3 &&
      ['qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual'].every((id) =>
        qwenIds.includes(id),
      );
    await shot(page, '03-search-qwen.png');
    await searchInput.fill('zzzz-无命中').catch(() => {});
    await page.waitForTimeout(300);
    const noneIds = await visibleRowIds(page);
    const noneOk = noneIds.length === 0;
    await searchInput.fill('').catch(() => {});
    await page.waitForTimeout(300);
    const allIds = await visibleRowIds(page);
    const clearOk = allIds.length === 38;
    filtersOk = qwenOk && noneOk && clearOk;
    filterDetail = filtersOk
      ? '搜索过滤：qwen→3 行（Token Plan 族）/ 无命中→0 / 清空→38'
      : `spec 11 A6：搜索应客户端过滤 38 项——qwen→${qwenIds.length} 行(期望 3) / 无命中→${noneIds.length}(期望 0) / 清空→${allIds.length}(期望 38)`;
  }
  check('search-filters', filtersOk, filterDetail);

  const deepseekSel = `${ROW}[data-preset-id="deepseek"]`;
  let keyFormOk = false;
  let keyFormDetail = 'spec 11 A6：点 api_key 族 preset 行应进该 preset 的密钥表单——preset 行缺失（前置未达）';
  if ((await softVisible(page, deepseekSel)) === true) {
    await page.click(deepseekSel).catch(() => {});
    const idValue = await page
      .locator('#dlg-provider-id')
      .inputValue()
      .catch(() => null);
    const labelValue = await page
      .locator('#dlg-provider-label')
      .inputValue()
      .catch(() => null);
    const pwdOk = await softVisible(page, '#dlg-provider-apikey');
    keyFormOk = idValue === 'deepseek' && labelValue === 'DeepSeek' && pwdOk;
    keyFormDetail = keyFormOk
      ? '点 DeepSeek 行进密钥表单（#dlg-provider-id/label 预填 deepseek/DeepSeek + 密钥输入在位）'
      : `spec 11 A6：密钥表单 = 自定义表单预填（#380 契约）——id="${idValue}" label="${labelValue}" 密钥输入=${pwdOk}`;
    await shot(page, '04-preset-keyform.png');
  }
  check('preset-key-form', keyFormOk, keyFormDetail);

  const closedOk = dlgOk
    ? await page
        .click(`${DLG} button[aria-label="关闭"]`)
        .then(() => softHidden(page, DLG))
        .catch(() => false)
    : false;
  check('keyform-closes', closedOk === true, closedOk ? '关闭钮关窗（#68 family law，aria-label 载体）' : '关窗失败/dialog 未开');

  await page.click(`${SHELL} [data-testid="resource-new"]`).catch(() => {});
  const xaiReopen = await softVisible(page, DLG);
  const xaiRowSel = `${ROW}[data-preset-id="xai"]`;
  let xaiLabelOk = false;
  if (xaiReopen && (await softVisible(page, xaiRowSel))) {
    await page.click(xaiRowSel).catch(() => {});
    const xaiText = await softText(page, DLG);
    xaiLabelOk = xaiText.includes('Sign in with SuperGrok or X Premium');
    await shot(page, '04b-xai-keyform.png');
  }
  check(
    'xai-oauth-label',
    xaiLabelOk,
    xaiLabelOk
      ? 'xai 密钥表单内展示 oauthLabel「Sign in with SuperGrok or X Premium」'
      : 'spec 11 A6/名单注：xai 的 oauthLabel 应在其密钥表单内展示——未命中（或 preset 行缺失，前置未达）',
  );
  if (xaiReopen) {
    await page.click(`${DLG} button[aria-label="关闭"]`).catch(() => {});
    await softHidden(page, DLG);
  }

  await page.click(`${SHELL} [data-testid="resource-new"]`).catch(() => {});
  const reopened = await softVisible(page, DLG);
  const entrySel = `${DLG} button:text-is("自定义端点")`;
  const entryOk = reopened && (await softVisible(page, entrySel));
  const entryText = entryOk ? await softText(page, entrySel) : '';
  check(
    'custom-disclosure-entry',
    entryOk === true && entryText.includes('自定义端点'),
    entryOk
      ? `「自定义端点」入口在位（"${oneLine(entryText)}"）`
      : 'spec 11 A6：dialog 底部应有「自定义端点」disclosure 入口（button:text-is("自定义端点")）——未实现',
  );

  const formFieldsOk = async () =>
    (await softVisible(page, '#dlg-provider-id', 2000)) &&
    (await softVisible(page, '#dlg-provider-baseurl', 2000)) &&
    (await softVisible(page, `${DLG} button:text-is("添加模型服务")`, 2000));
  let formReachable = false;
  if (entryOk) {
    await page.click(entrySel).catch(() => {});
    formReachable = await formFieldsOk();
  } else {

    formReachable = reopened && (await formFieldsOk());
  }
  check(
    'disclosure-expands-form',
    entryOk === true && formReachable,
    entryOk
      ? formReachable
        ? 'disclosure 展开现有自定义网关表单（#dlg-provider-id/baseurl/button:text-is("添加模型服务") 句柄保全）'
        : 'spec 11 A6：disclosure 展开后应见现有表单三句柄——字段未出现'
      : `spec 11 A6：「自定义端点」入口缺失——现有表单为${formReachable ? '外露形态（现状）' : '不可达'}`,
  );
  await shot(page, '05-disclosure-form.png');

  let created = false;
  if (formReachable) {
    await page.fill('#dlg-provider-id', newProvider.providerId).catch(() => {});
    await page.fill('#dlg-provider-label', newProvider.label).catch(() => {});
    await page.fill('#dlg-provider-baseurl', newProvider.baseUrl).catch(() => {});
    await page.click(`${DLG} button:text-is("添加模型")`).catch(() => {});
    const modelInputOk = await softVisible(page, `${DLG} input[aria-label="模型 ID"]`);
    if (modelInputOk) {
      await page
        .locator(`${DLG} input[aria-label="模型 ID"]`)
        .last()
        .fill(newProvider.modelId)
        .catch(() => {});
    }
    await shot(page, '06-form-filled.png');
    await page.click(`${DLG} button:text-is("添加模型服务")`).catch(() => {});
    created = await softHidden(page, DLG);
  }
  check(
    'create-e2e',
    created,
    created
      ? `填表（含模型行 ${newProvider.modelId}）→ 保存 → dialog 关闭`
      : `保存后 dialog 未关闭/表单不可达——创建链（POST providers）未走通${formReachable ? '' : '（前置 disclosure/表单缺失）'}`,
  );

  const envRes =
    teamId != null
      ? await tryGetJson(`${SERVER}/api/teams/${teamId}/providers`)
      : { ok: false, error: '无 teamId' };
  const providers = envRes.ok && Array.isArray(envRes.data?.providers) ? envRes.data.providers : [];
  const createdRow = providers.find((p) => p.providerId === newProvider.providerId);
  check(
    'api-provider-row',
    createdRow != null &&
      createdRow.label === newProvider.label &&
      createdRow.baseUrl === newProvider.baseUrl &&
      Array.isArray(createdRow.models) &&
      createdRow.models.some((m) => m.id === newProvider.modelId),
    createdRow != null
      ? `GET providers 封套含新行（label=${createdRow.label}, models=${createdRow.models?.length ?? 0}）`
      : `POST 后 GET /api/teams/:id/providers 应含 ${newProvider.providerId}——实测 providers=[${providers
          .map((p) => p.providerId)
          .join(', ') || '空'}]${envRes.ok ? '' : `（${envRes.error}）`}`,
  );

  const dbTruth = dbQuery((db) => ({
    row: db
      .prepare('SELECT id, providerId, label, baseUrl, models FROM provider WHERE providerId = ?')
      .get(newProvider.providerId),
  }));
  let dbModels = null;
  try {
    dbModels = dbTruth.row?.models != null ? JSON.parse(dbTruth.row.models) : null;
  } catch {
    dbModels = null;
  }
  check(
    'db-provider-row',
    dbTruth.row != null && Array.isArray(dbModels) && dbModels.some((m) => m.id === newProvider.modelId),
    dbTruth.row != null
      ? `SQLite provider 行在（models JSON ${Array.isArray(dbModels) ? dbModels.length : '?'} 项）`
      : `SQLite provider 表应含 ${newProvider.providerId} 行——${dbTruth.reason ?? '行缺失'}`,
  );
  await shot(page, '07-after-create.png');
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
  probe: 'provider-picker',
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: stack.homeDir },
  checks,
  artifacts,
  ...extra,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive provider-picker:PASS' : `drive provider-picker:FAIL(${checks.filter((c) => !c.ok).length} 项)`}\n`,
);
process.exit(ok ? 0 : 1);
