// XMON-40 验证驱动：创建 Agent 弹窗「模型」选择区在模型很多时的显示与可选性。
//
// 验收标准（唯一依据，来自 XMON-40 issue 正文，非实现者自述）：
//   「创建 Agent 页面的「模型设置」区域，在模型数量很多时显示正常——不溢出、
//     不裁切、不破版、可正常浏览，且所有模型都能被正常选中。」
//
// 只采可观测事实：DOM 几何 + 真实点击结果 + API 数据源计数；不读实现代码反推需求。
//
// 用法（栈须先由 verify-cairn launch.mjs 起好）：
//   node integration/verify/xmon-40-agent-model-menu.mjs
// env: VERIFY_WEB_PORT / VERIFY_EVIDENCE_DIR / XMON40_MODEL_COUNT / XMON40_TAG

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const ports = JSON.parse(readFileSync(join(ROOT, '.claude/verify-run/ports.json'), 'utf8'));
const WEB = process.env.VERIFY_WEB_PORT
  ? `http://127.0.0.1:${process.env.VERIFY_WEB_PORT}`
  : `http://127.0.0.1:${ports.webPort}`;
const API = `http://127.0.0.1:${ports.serverPort}`;
const TAG = process.env.XMON40_TAG ?? 'xmon40-agent-model-menu';

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(ROOT, '.claude/verify-evidence', `${STAMP}-${TAG}`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const record = (ok, label, detail) => {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const PROVIDER_ID = 'xmon40-gw';
const PROVIDER_LABEL = 'XMON40 网关';

/** 「模型太多」条件的规模。事实底座：fresh 栈的模型候选只有 5 条（本机
 *  claude-code 槽位），自定义服务商为空——达不到用户报的「太多」。本品把页面
 *  推到该条件下，数据经应用自身的「添加服务商」表单写入（真用户路径），
 *  不是在 DOM 上造假。 */
const MODEL_COUNT = Number(process.env.XMON40_MODEL_COUNT ?? 40);

const TRIGGER = '.dlg-agent-model-select';
const MENU = '.dlg-agent-model-menu';
const OPTION = `${MENU} [role="option"]`;

async function teamId(page) {
  return page.evaluate(async () => (await (await fetch('/api/teams')).json())[0].id);
}

/** 候选条数真值：自定义服务商 models[]（去重、剔空 id）∪ model-sources 非 pi 段。 */
async function expectedCount(page) {
  const tid = await teamId(page);
  return page.evaluate(async (team) => {
    const env = await (await fetch(`/api/teams/${team}/providers`)).json();
    const src = await (await fetch(`/api/teams/${team}/model-sources`)).json();
    const seen = new Set();
    for (const p of env.providers) for (const m of p.models) if (m.id !== '') seen.add(`${p.providerId}/${m.id}`);
    for (const s of src.sources) {
      if (s.runtime === 'pi') continue;
      for (const m of s.models) seen.add(`${s.runtime}/${m.id}`);
    }
    return seen.size + 1; // + 「未设置模型」行
  }, tid);
}

async function seedProviderWithManyModels(page) {
  await page.goto(`${WEB}/app/resources/providers`);
  await page.waitForSelector('.res-new', { timeout: 15_000 });
  await page.click('.res-new');
  await page.waitForSelector('.dlg-picker-custom', { timeout: 15_000 });
  await page.click('.dlg-picker-custom');

  await page.waitForSelector('#dlg-provider-id', { timeout: 15_000 });
  await page.fill('#dlg-provider-id', PROVIDER_ID);
  await page.fill('#dlg-provider-label', PROVIDER_LABEL);
  await page.fill('#dlg-provider-baseurl', 'https://example.invalid/v1');
  await page.fill('#dlg-provider-apikey', 'sk-xmon40-not-a-real-key');

  for (let i = 0; i < MODEL_COUNT; i += 1) await page.click('.dlg-provider-model-add');
  const rows = page.locator('input[aria-label="模型 ID"]');
  const n = await rows.count();
  for (let i = 0; i < n; i += 1) {
    // 名字长短混排：每第 4 条给超长名，覆盖「破版」（长名不换行/不省略撑破行）。
    const id = i % 4 === 3
      ? `xmon40-model-with-a-very-long-identifier-${String(i).padStart(3, '0')}-v1-preview`
      : `xmon40-model-${String(i).padStart(3, '0')}`;
    await rows.nth(i).fill(id);
  }
  await page.click('.dlg-provider-create');

  const tid = await teamId(page);
  const envelope = await page.evaluate(async (team) => {
    for (let i = 0; i < 60; i += 1) {
      const body = await (await fetch(`/api/teams/${team}/providers`)).json();
      if (body.providers.length > 0) return body;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { providers: [] };
  }, tid);
  const created = envelope.providers.find((p) => p.providerId === PROVIDER_ID);
  record(created != null && created.models.length === MODEL_COUNT,
    'seed: 自定义服务商经应用表单建成且模型数对账',
    `providers=${envelope.providers.length} models=${created?.models.length} 期望=${MODEL_COUNT}`);
}

async function openCreateAgentDialog(page) {
  await page.goto(`${WEB}/app/team`);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  await page.waitForSelector(`[role="dialog"] ${TRIGGER}`, { timeout: 15_000 });
}

async function measure(page) {
  return page.evaluate(({ menuSel, optSel }) => {
    const menu = document.querySelector(menuSel);
    const r = menu.getBoundingClientRect();
    const cs = getComputedStyle(menu);
    // 有效可见区 = 视口 ∩ 所有 overflow 非 visible 的祖先（弹窗体的滚动盒
    // `.dlg-body` 就在其中）。只按菜单自身矩形算可见度会漏掉「被祖先裁掉」
    // 这一正是本票症状的形态。
    let clip = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (let el = menu.parentElement; el; el = el.parentElement) {
      const acs = getComputedStyle(el);
      if (/(auto|scroll|hidden|clip)/.test(`${acs.overflowX}${acs.overflowY}`)) {
        const b = el.getBoundingClientRect();
        clip = {
          top: Math.max(clip.top, b.top),
          left: Math.max(clip.left, b.left),
          right: Math.min(clip.right, b.right),
          bottom: Math.min(clip.bottom, b.bottom),
        };
      }
    }
    const intersect = (rr, c) => Math.max(0, Math.min(rr.bottom, c.bottom) - Math.max(rr.top, c.top));
    const rows = [...menu.querySelectorAll(optSel)].map((o, i) => {
      const rr = o.getBoundingClientRect();
      const inMenu = Math.round(intersect(rr, r));
      return {
        i,
        text: o.textContent.trim(),
        h: Math.round(rr.height),
        visibleH: inMenu,
        visibleInClip: Math.round(intersect(rr, clip)),
        inMenuWindow: inMenu > 0 && inMenu < rr.height - 0.5,
        scrollW: o.scrollWidth,
        clientW: o.clientWidth,
      };
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width },
      clip,
      css: { overflowY: cs.overflowY, maxHeight: cs.maxHeight, height: cs.height },
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      scrollTop: menu.scrollTop,
      optionCount: rows.length,
      rows,
      // 被祖先裁剪盒切掉的行（本票症状：菜单比「触发钮上缘到 body 上缘」高时，
      // 顶部若干行被 .dlg-body 裁掉，画不出也点不中）。
      cutByAncestor: rows.filter((x) => x.visibleInClip < x.visibleH - 0.5).length,
      menuInsideClip: r.top >= clip.top - 0.5 && r.bottom <= clip.bottom + 0.5,
      insideViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      // 「裁切」判据 = 行被容器边缘切开（0 < 可见高 < 整高）。滚动列表的窗口
      // 边缘天然切开至多一行，故分开统计：partialAtEdge 允许 ≤1，
      // 真正的缺陷是「有行永远进不了完整可见态」——由 scrollEveryRow 证明。
      partialRows: rows.filter((x) => x.visibleH > 0 && x.visibleH < x.h - 0.5).length,
      rowOverflow: rows.filter((x) => x.scrollW > x.clientW + 1).length,
    };
  }, { menuSel: MENU, optSel: OPTION });
}

/** 逐行滚入 → 断言每一条都能达到完整可见；顺带逐条点选并核对回显。 */
async function walkEveryOption(page) {
  const names = await page.$$eval(OPTION, (els) =>
    els.map((e) => e.querySelector('[class$="-row-name"]')?.textContent?.trim() ?? e.textContent.trim()));
  const notFullyReachable = [];
  const clickFailures = [];
  for (let i = 0; i < names.length; i += 1) {
    if (!(await page.isVisible(MENU))) await page.click(TRIGGER);
    const option = page.locator(OPTION).nth(i);
    await option.scrollIntoViewIfNeeded();
    const state = await option.evaluate((el, menuSel) => {
      const rr = el.getBoundingClientRect();
      const menuEl = document.querySelector(menuSel);
      const menu = menuEl.getBoundingClientRect();
      // 与 measure() 同口径的有效可见区：视口 ∩ overflow 非 visible 的祖先。
      let clip = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
      for (let p = menuEl.parentElement; p; p = p.parentElement) {
        const acs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(`${acs.overflowX}${acs.overflowY}`)) {
          const b = p.getBoundingClientRect();
          clip = {
            top: Math.max(clip.top, b.top),
            left: Math.max(clip.left, b.left),
            right: Math.min(clip.right, b.right),
            bottom: Math.min(clip.bottom, b.bottom),
          };
        }
      }
      const inMenu = Math.max(0, Math.min(rr.bottom, menu.bottom) - Math.max(rr.top, menu.top));
      const inClip = Math.max(0, Math.min(rr.bottom, clip.bottom) - Math.max(rr.top, clip.top));
      return {
        visibleH: Math.round(inMenu),
        visibleInClip: Math.round(inClip),
        h: Math.round(rr.height),
        inViewport: rr.top >= 0 && rr.bottom <= window.innerHeight,
      };
    }, MENU);
    if (state.visibleInClip < state.h - 0.5 || !state.inViewport) {
      notFullyReachable.push({ i, name: names[i], ...state });
    }
    try {
      await option.click({ timeout: 5_000 });
    } catch (err) {
      clickFailures.push({ i, name: names[i], why: `点击失败：${String(err).split('\n')[0]}` });
      if (await page.isVisible(MENU)) await page.keyboard.press('Escape');
      continue;
    }
    const label = (await page.textContent(TRIGGER)).trim();
    if (label !== names[i]) clickFailures.push({ i, name: names[i], why: `回显为「${label}」` });
  }
  return { total: names.length, names, notFullyReachable, clickFailures };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const evidence = { web: WEB, api: API, modelCount: MODEL_COUNT, runs: [] };

// —— 场景 1：栈自带的真实候选（未扩量）= 标准里的「真实全量列表」基线
await openCreateAgentDialog(page);
await page.click(TRIGGER);
await page.waitForSelector(MENU, { timeout: 10_000 });
await page.waitForTimeout(300); // 等 anim-pop 收尾，截图与几何都取稳定态
const baseline = await measure(page);
await page.screenshot({ path: join(EVIDENCE, '01-baseline-real-list.png') });
evidence.runs.push({ name: 'baseline-real-list', ...baseline });
record(baseline.insideViewport && baseline.partialRows <= 1,
  'baseline: 真实候选（未扩量）菜单在视口内、无行被切',
  `options=${baseline.optionCount} box=${Math.round(baseline.box.top)}..${Math.round(baseline.box.bottom)} vp=${baseline.viewport.h}`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// —— 场景 2：模型很多（经应用「添加服务商」表单写入的真实记录）
await seedProviderWithManyModels(page);
const want = await expectedCount(page);

await openCreateAgentDialog(page);
await page.click(TRIGGER);
await page.waitForSelector(MENU, { timeout: 10_000 });
await page.waitForTimeout(300);
const many = await measure(page);
await page.screenshot({ path: join(EVIDENCE, '02-many-models-open.png') });
evidence.runs.push({ name: 'many-models-1440x732', ...many });

record(many.optionCount === want,
  'many: 候选条数 = 数据源并集数 + 「未设置模型」行',
  `options=${many.optionCount} 期望=${want}`);
record(many.insideViewport,
  'many: 菜单容器整体落在视口内（不溢出）',
  `top=${Math.round(many.box.top)} bottom=${Math.round(many.box.bottom)} 视口高=${many.viewport.h}`);
record(many.scrollHeight > many.clientHeight && many.css.overflowY === 'auto',
  'many: 列表可滚动（可正常浏览）',
  `overflow-y=${many.css.overflowY} scrollHeight=${many.scrollHeight} clientHeight=${many.clientHeight}`);
record(many.menuInsideClip && many.cutByAncestor === 0,
  'many: 菜单不被弹窗体裁剪盒切掉任何一行（不裁切）',
  `菜单盒 ${Math.round(many.box.top)}..${Math.round(many.box.bottom)} 裁剪盒 ${Math.round(many.clip.top)}..${Math.round(many.clip.bottom)} 被切行数=${many.cutByAncestor}`);
record(many.rowOverflow === 0,
  'many: 含超长模型名的行未撑破宽度（不破版）',
  `行内横向溢出=${many.rowOverflow}`);
record(many.rows[0].visibleInClip >= many.rows[0].h - 0.5,
  'many: 打开瞬间首行完整可见（「前几行被裁不可点」不复现）',
  `首行「${many.rows[0].text}」可见高=${many.rows[0].visibleInClip}/${many.rows[0].h}`);

await page.$eval(MENU, (el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(150);
const scrolled = await measure(page);
await page.screenshot({ path: join(EVIDENCE, '03-many-models-scrolled-bottom.png') });
evidence.runs.push({ name: 'many-models-scrolled-bottom', ...scrolled });
const last = scrolled.rows[scrolled.rows.length - 1];
record(last.visibleInClip >= last.h - 0.5,
  'many: 滚到底后末行完整可见（浏览可达末端）',
  `末行「${last.text}」可见高=${last.visibleInClip}/${last.h}`);

// —— 场景 3：逐行滚入 + 逐个点选
const walk = await walkEveryOption(page);
evidence.walk = walk;
await page.screenshot({ path: join(EVIDENCE, '04-after-walk.png') });
record(walk.notFullyReachable.length === 0,
  'many: 每一条都能被滚到完整可见（不裁切）',
  `可达 ${walk.total - walk.notFullyReachable.length}/${walk.total}${walk.notFullyReachable.length ? ` 不可达：${JSON.stringify(walk.notFullyReachable.slice(0, 5))}` : ''}`);
record(walk.clickFailures.length === 0,
  'many: 每一条都能被选中且回显正确（所有模型都能被正常选中）',
  `选中 ${walk.total - walk.clickFailures.length}/${walk.total}${walk.clickFailures.length ? ` 失败：${JSON.stringify(walk.clickFailures.slice(0, 5))}` : ''}`);

// —— 场景 4：较矮视口下的同一处（显示区域是否随可用高度收敛）
const shortResult = {};
for (const [w, h] of [[1366, 600], [1440, 500]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  if (!(await page.isVisible(MENU))) await page.click(TRIGGER);
  await page.waitForTimeout(300);
  const m = await measure(page);
  shortResult[`${w}x${h}`] = m;
  await page.screenshot({ path: join(EVIDENCE, `05-viewport-${w}x${h}.png`) });
  evidence.runs.push({ name: `many-models-${w}x${h}`, ...m });
}
record(Object.values(shortResult).every((m) => m.insideViewport && m.cutByAncestor === 0 && m.rows[0].visibleInClip >= m.rows[0].h - 0.5),
  'short: 1366×600 与 1440×500 下菜单仍在视口内、不被切且首行完整',
  Object.entries(shortResult).map(([k, m]) => `${k}: top=${Math.round(m.box.top)} bottom=${Math.round(m.box.bottom)} vp=${m.viewport.h} maxH=${m.css.maxHeight} 被切=${m.cutByAncestor}`).join(' / '));

evidence.pageErrors = errors;
record(errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e)).length === 0,
  '全程无页面错误',
  errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e)).slice(0, 3).join(' | ') || '0 条');

await browser.close();

const failed = checks.filter((c) => !c.ok);
writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({
  probe: 'xmon-40-agent-model-menu', at: new Date().toISOString(), web: WEB, api: API, modelCount: MODEL_COUNT, checks, evidence,
}, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks ok`);
console.log(`evidence: ${EVIDENCE}`);
process.exit(failed.length === 0 ? 0 : 1);