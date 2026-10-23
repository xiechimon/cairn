#!/usr/bin/env node
// verify-cairn drive-chief-model-select — 总管设置压缩模型选择器数据源
// （spec 11 §A10，#358）。
//
// 真用户路径：/app（board）→ 总管 FAB 开 drawer → gear（总管设置）换内容区
// → Agent tab → 压缩模型选择器 button[aria-label="压缩模型"] → 展开
// [role="dialog"][aria-label="压缩模型"]（#950 载体：旧 button.chief-select /
// .chief-model-menu 类钩退役）。
//
// 验 #358 的 live 面（fixture e2e 覆盖不到的「hook → mapper → DOM」段），
// 数据契约按 #770 用户裁决后的现行形（正本 api/mappers.ts toModelOptions）：
//   #770 排除裁决 —— custom providers 不再进 picker 候选；选项清单 =
//       GET model-sources 非 pi 段投影。铺底 provider 的模型仍会出现在
//       model-sources 输出里（pi 段，数据通路活着），但**不得**进选择器行。
//   #707 机器跟随 —— claude-code 段 = 执行机 daemon 上报；未注册 daemon 的
//       verify 栈上非 pi 段恒空，选择器只有默认行，这是预期真值不是故障。
//   并集一致性 —— 选择器非默认行 (providerLabel, modelName) 集合 ==
//       toModelOptions(GET model-sources) 的期望投影（driver 内复刻现行
//       mapper 逻辑做 UI=API 双真值对拍）。
//   原「铺 provider → 行随之变」的 AC1 行变化腿随 #770 裁决退役（该数据
//       通道已不供 picker）；行变化面由 fixture e2e 的 options 面承接。
//
// 铺底走公开 REST POST /api/teams/:id/providers（非被测路径，drive.mjs search
// probe 铺底律）。依赖全新库：重验 = 重 launch。
// 用法：VERIFY_REPO_ROOT=<worktree> node drive-chief-model-select.mjs

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
  join(SCRIPT_REPO, '.claude/verify-evidence/' + ts + '-chief-model-select');
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
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('POST ' + url + ' → ' + res.status + ': ' + (await res.text()));
  return res.json();
}

// driver 内复刻 api/mappers.ts toModelOptions（#358；#770 起 providers 段已除）
// 做 UI=API 对拍：只剩非 pi runtime 段（provider 位 = runtime 词表值；段卫生：
// 空 id 跳过），同 (provider, modelId) 去重 first-wins。
function expectedOptions(sources) {
  const out = [];
  const seen = new Set();
  function push(o) {
    const k = o.provider + '/' + o.modelId;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(o);
  }
  for (const s of sources) {
    if (s.runtime === 'pi') continue;
    const providerLabel = s.runtime === 'claude-code' ? 'Claude Code' : s.runtime;
    for (const m of s.models ?? []) {
      if (m.id === '') continue;
      push({ provider: s.runtime, providerLabel, modelId: m.id, modelName: m.name });
    }
  }
  return out;
}
function rowKey(providerLabel, modelName) {
  return providerLabel + '\u0000' + modelName;
}
function sortedKeys(list) {
  return list.map((r) => rowKey(r.providerLabel, r.modelName)).sort();
}

const PAGE_PATH = '/app';
const FAB = 'button[aria-label="总管"]';
const GEAR = 'button[aria-label="总管设置"]';
const SETTINGS = 'h1:text-is("总管设置")';
const SELECT_BTN = 'button[aria-label="压缩模型"]';
const MENU = '[role="dialog"][aria-label="压缩模型"]';

// 从 board 走到压缩模型选择器并展开菜单（真用户路径：FAB → gear → select）。
// 行读取不与取数竞态：进面后等 model-sources 响应落地再开菜单（未发请求 =
// 缓存命中，等待超时吞掉不阻塞）。
async function openModelMenu(page) {
  const sourcesFetched = page
    .waitForResponse((res) => res.url().includes('/model-sources'), { timeout: 8000 })
    .catch(() => {});
  await page.goto(WEB + PAGE_PATH);
  await page.waitForSelector(FAB, { timeout: 15000 });
  await page.click(FAB);
  await page.waitForSelector(GEAR, { state: 'visible', timeout: 8000 });
  await page.click(GEAR);
  await page.waitForSelector(SETTINGS, { timeout: 8000 });
  await sourcesFetched;
  await page.waitForSelector(SELECT_BTN, { timeout: 8000 });
  await page.click(SELECT_BTN);
  await page.waitForSelector(MENU, { state: 'visible', timeout: 8000 });
}

// 读菜单里的行：默认行（无 provider 副题）+ 模型行（有 provider 副题 span）。
// #950 载体：行 = role=option；名 = data-testid="model-pick-name"；副题 =
// 行内唯一无 data-testid 的 span（check 勾形也带 testid，不误中）。
async function readMenuRows(page) {
  return page.evaluate((menuSel) => {
    const menu = document.querySelector(menuSel);
    if (menu == null) return { total: 0, model: [] };
    const rows = [...menu.querySelectorAll('[role="option"]')];
    const model = rows
      .map((r) => {
        const name = r.querySelector('[data-testid="model-pick-name"]');
        const prov = r.querySelector('span:not([data-testid])');
        return {
          modelName: name ? (name.textContent ?? '').trim() : '',
          providerLabel: prov ? (prov.textContent ?? '').trim() : '',
          isDefault: prov == null,
        };
      })
      .filter((r) => !r.isDefault);
    return { total: rows.length, model };
  }, MENU);
}
const stamp = Date.now() % 100000;
const provA = {
  providerId: 'verify-gw-a-' + stamp,
  label: '验证网关A' + stamp,
  baseUrl: 'https://gw-a.verify.example.com/v1',
  api: 'openai-completions',
  authHeader: true,
  models: [
    { id: 'va-model-x-' + stamp, name: '验证A模型X' + stamp },
    { id: 'va-model-y-' + stamp, name: '验证A模型Y' + stamp },
  ],
};
const provB = {
  providerId: 'verify-gw-b-' + stamp,
  label: '验证网关B' + stamp,
  baseUrl: 'https://gw-b.verify.example.com/v1',
  api: 'openai-completions',
  authHeader: true,
  models: [{ id: 'vb-model-z-' + stamp, name: '验证B模型Z' + stamp }],
};

const extra = {};
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

async function seedProvider(teamId, prov) {
  try {
    await postJson(SERVER + '/api/teams/' + teamId + '/providers', prov);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}
async function apiTruth(teamId) {
  const msEnv = await getJson(SERVER + '/api/teams/' + teamId + '/model-sources');
  return { expected: expectedOptions(msEnv.sources ?? []), sources: msEnv.sources ?? [] };
}

// 铺底模型是否抵达 model-sources 输出（任意段——数据通路活着的实证；
// #770 后它们落在 pi 段，picker 投影天然排除）。
function sourcesContainModels(sources, models) {
  const flat = (sources ?? []).flatMap((s) => (s.models ?? []).map((m) => m.id));
  return models.every((m) => flat.includes(m.id));
}
// #770 排除裁决腿：铺底模型不得出现在选择器行里。
function pickerExcludes(rows, models) {
  const names = new Set(models.map((m) => m.name));
  return rows.every((r) => !names.has(r.modelName));
}

try {
  const teams = await getJson(SERVER + '/api/teams');
  const teamId = teams?.[0]?.id ?? null;
  check(
    'api-team-ready',
    teamId != null,
    teamId != null ? 'GET /api/teams teamId=' + teamId : '取 teamId 失败',
  );

  // 基线：全新库 + 未注册 daemon → 非 pi 段恒空，选择器只有默认行；
  // UI=API 对拍从基线就开始（不是「空对空」的摆设——若本机有 daemon 上报过
  // claude-code 段，基线期望投影会带上它，UI 必须同现）。
  await openModelMenu(page);
  const baseline = await readMenuRows(page);
  await shot(page, '01-baseline.png');
  const truth0 = teamId != null ? await apiTruth(teamId) : { expected: [], sources: [] };
  extra.baselineRows = baseline.model;
  extra.expectedBaseline = truth0.expected;
  const same0 =
    JSON.stringify(sortedKeys(baseline.model)) === JSON.stringify(sortedKeys(truth0.expected));
  check(
    'baseline-union',
    same0,
    same0
      ? '基线 UI==API：非默认行 ' + baseline.model.length + ' == 期望投影 ' + truth0.expected.length
      : '基线 UI≠API：UI ' +
        JSON.stringify(sortedKeys(baseline.model)) +
        ' vs 期望 ' +
        JSON.stringify(sortedKeys(truth0.expected)),
  );

  // 铺底 provider A（2 模型）→ 重载走真路径 → #770 裁决：模型抵达
  // model-sources（pi 段）但不进选择器行。
  const seedA = teamId != null ? await seedProvider(teamId, provA) : { ok: false, error: '无 teamId' };
  check(
    'seed-provider-a',
    seedA.ok,
    seedA.ok ? 'POST provider A（' + provA.models.length + ' 模型）' : '铺底 A 失败：' + seedA.error,
  );
  const truthA = teamId != null ? await apiTruth(teamId) : { expected: [], sources: [] };
  check(
    'a-models-reach-sources',
    sourcesContainModels(truthA.sources, provA.models),
    'A 模型出现在 GET model-sources（数据通路活）',
  );
  await openModelMenu(page);
  const afterA = await readMenuRows(page);
  await shot(page, '02-provider-a.png');
  const aExcluded = pickerExcludes(afterA.model, provA.models);
  check(
    'ruling-770-exclusion-a',
    aExcluded,
    aExcluded
      ? '#770 裁决：provider A 模型不进选择器行（非默认行 ' + afterA.model.length + '）'
      : '#770 裁决被破坏：custom provider 模型出现在 picker——实测 ' +
        JSON.stringify(afterA.model.slice(0, 6)),
  );
  extra.expectedAfterA = truthA.expected;
  extra.uiAfterA = afterA.model;
  const sameA =
    JSON.stringify(sortedKeys(afterA.model)) === JSON.stringify(sortedKeys(truthA.expected));
  check(
    'union-consistency-a',
    sameA,
    sameA
      ? '并集一致：选择器行集合 == toModelOptions(sources) 期望投影（' + truthA.expected.length + ' 行）'
      : 'UI≠API：UI ' +
        JSON.stringify(sortedKeys(afterA.model)) +
        ' vs 期望 ' +
        JSON.stringify(sortedKeys(truthA.expected)),
  );
  // 铺底 provider B（1 模型）→ 重载 → 同律：抵达 sources、被 picker 排除、
  // 并集仍一致（delta 驱动 = 配置变化，断言面 = 排除 + 一致）。
  const seedB = teamId != null ? await seedProvider(teamId, provB) : { ok: false, error: '无 teamId' };
  check(
    'seed-provider-b',
    seedB.ok,
    seedB.ok ? 'POST provider B（1 模型）' : '铺底 B 失败：' + seedB.error,
  );
  const truthB = teamId != null ? await apiTruth(teamId) : { expected: [], sources: [] };
  check(
    'b-models-reach-sources',
    sourcesContainModels(truthB.sources, provB.models),
    'B 模型出现在 GET model-sources（数据通路活）',
  );
  await openModelMenu(page);
  const afterB = await readMenuRows(page);
  await shot(page, '03-provider-b-added.png');
  const bExcluded = pickerExcludes(afterB.model, provB.models);
  check(
    'ruling-770-exclusion-b',
    bExcluded,
    (bExcluded ? 'B 模型不进选择器行' : 'B 模型漏进 picker') +
      '；非默认行数 ' +
      afterA.model.length +
      '→' +
      afterB.model.length,
  );
  const sameB =
    JSON.stringify(sortedKeys(afterB.model)) === JSON.stringify(sortedKeys(truthB.expected));
  check(
    'union-consistency-b',
    sameB,
    sameB
      ? 'B 加入后行集合仍 == 期望投影（' + truthB.expected.length + ' 行）'
      : 'B 后 UI≠API：UI ' +
        JSON.stringify(sortedKeys(afterB.model)) +
        ' vs 期望 ' +
        JSON.stringify(sortedKeys(truthB.expected)),
  );
  extra.providerA = { providerId: provA.providerId, label: provA.label, models: provA.models };
  extra.providerB = { providerId: provB.providerId, label: provB.label, models: provB.models };
  extra.afterBRows = afterB.model;
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
  probe: 'chief-model-select',
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
      ? 'drive chief-model-select:PASS'
      : 'drive chief-model-select:FAIL(' + checks.filter((c) => !c.ok).length + ' 项)') +
    '\n',
);
process.exit(ok ? 0 : 1);