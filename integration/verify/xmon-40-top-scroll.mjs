// XMON-40 复查驱动：模型很多时，菜单**上端**能不能用真实滚轮划到。
//
// 用户反馈（2026-10-01）：「不是长度，而是上下。你没看见它的上端？划不过去吗？
// 比如说，你的模型足够多的时候，它的上端感觉滑动是有问题的。」
//
// 上一轮用 scrollIntoViewIfNeeded + 直接写 scrollTop，都不是真用户输入。本支
// 全程只用真实滚轮事件（page.mouse.wheel）与真实点击，不借助任何"程序化滚到
// 目标"；并带一个改动前对照（把本轮唯一那行实现改动在运行时还原）验探针能红。
//
// 用法（栈须先由 verify-cairn launch.mjs 起好）：
//   node integration/verify/xmon-40-top-scroll.mjs

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const ports = JSON.parse(readFileSync(join(ROOT, '.claude/verify-run/ports.json'), 'utf8'));
const WEB = `http://127.0.0.1:${process.env.VERIFY_WEB_PORT ?? ports.webPort}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE = process.env.VERIFY_EVIDENCE_DIR ?? join(ROOT, '.claude/verify-evidence', `${STAMP}-xmon40-top-scroll`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const record = (ok, label, detail) => {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const MODEL_COUNT = Number(process.env.XMON40_MODEL_COUNT ?? 40);
const TRIGGER = '.dlg-agent-model-select';
const MENU = '.dlg-agent-model-menu';
const OPTION = `${MENU} [role="option"]`;
const BODY = '.dlg-body';
// 本轮待验改动只有一行：`.dlg-agent-model-menu { max-height: 192px }`（改动前是
// 家族值 300px）。对照把这一行还原成 300px —— 与真检出 38c945b9 的实测几何
// 逐值一致（菜单盒 top=140、被裁 4 行、首行可见高 0），故二者等价。
const PREFIX_MAXHEIGHT = Number(process.env.XMON40_PREFIX_MAXHEIGHT ?? 300);

async function seed(page) {
  await page.goto(`${WEB}/app/team`);
  const tid = await page.evaluate(async () => (await (await fetch('/api/teams')).json())[0].id);
  const existing = await page.evaluate(async (team) => (await (await fetch(`/api/teams/${team}/providers`)).json()).providers, tid);
  if (existing.some((p) => p.providerId === 'xmon40-gw' && p.models.length === MODEL_COUNT)) {
    record(true, 'seed: 40 模型服务商已在库中（复用）', `providers=${existing.length}`);
    return;
  }
  await page.goto(`${WEB}/app/resources/providers`);
  await page.waitForSelector('.res-new', { timeout: 15_000 });
  await page.click('.res-new');
  await page.waitForSelector('.dlg-picker-custom', { timeout: 15_000 });
  await page.click('.dlg-picker-custom');
  await page.waitForSelector('#dlg-provider-id', { timeout: 15_000 });
  await page.fill('#dlg-provider-id', 'xmon40-gw');
  await page.fill('#dlg-provider-label', 'XMON40 网关');
  await page.fill('#dlg-provider-baseurl', 'https://example.invalid/v1');
  await page.fill('#dlg-provider-apikey', 'sk-xmon40-not-a-real-key');
  for (let i = 0; i < MODEL_COUNT; i += 1) await page.click('.dlg-provider-model-add');
  const rows = page.locator('input[aria-label="模型 ID"]');
  const n = await rows.count();
  for (let i = 0; i < n; i += 1) await rows.nth(i).fill(`xmon40-model-${String(i).padStart(3, '0')}`);
  await page.click('.dlg-provider-create');
  const env = await page.evaluate(async (team) => {
    for (let i = 0; i < 60; i += 1) {
      const body = await (await fetch(`/api/teams/${team}/providers`)).json();
      if (body.providers.length > 0) return body;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { providers: [] };
  }, tid);
  record(env.providers.length === 1, 'seed: 40 模型的自定义服务商经应用表单建成', `providers=${env.providers.length}`);
}

/** 菜单盒、弹窗体可视带、逐行可见高、行命中测试（点击会落到谁身上）。 */
async function snap(page, tag) {
  return page.evaluate(({ menuSel, optSel, bodySel, tag }) => {
    const menuEl = document.querySelector(menuSel);
    const bodyEl = document.querySelector(bodySel);
    const menu = menuEl.getBoundingClientRect();
    const body = bodyEl.getBoundingClientRect();
    const clip = { top: Math.max(0, body.top), bottom: Math.min(window.innerHeight, body.bottom) };
    const vis = (r, c) => Math.round(Math.max(0, Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top)));
    const rows = [...menuEl.querySelectorAll(optSel)].map((o, i) => {
      const rr = o.getBoundingClientRect();
      // 行的中心点若落在裁剪带外，浏览器实际把事件给了谁——这决定点得中点不中。
      const hit = document.elementFromPoint(rr.left + 10, rr.top + rr.height / 2);
      return {
        i, text: o.textContent.trim().slice(0, 30),
        h: Math.round(rr.height), top: Math.round(rr.top),
        inMenu: vis(rr, menu), inClip: vis(rr, clip),
        hit: hit ? `${hit.tagName}.${String(hit.className).split(' ')[0]}` : null,
      };
    });
    return {
      tag,
      menu: { top: Math.round(menu.top), bottom: Math.round(menu.bottom), h: Math.round(menu.height) },
      menuScroll: { top: menuEl.scrollTop, max: menuEl.scrollHeight - menuEl.clientHeight, clientH: menuEl.clientHeight },
      body: { top: Math.round(body.top), bottom: Math.round(body.bottom), scrollTop: bodyEl.scrollTop, scrollable: bodyEl.scrollHeight > bodyEl.clientHeight + 1 },
      maxHeight: getComputedStyle(menuEl).maxHeight,
      firstRow: rows[0],
      lastRow: rows[rows.length - 1],
      // 被祖先裁没：菜单认为它露着，裁剪带却一个像素都不给——画不出也点不中。
      rowsClippedAway: rows.filter((r) => r.inMenu > 0 && r.inClip === 0).length,
      // 被祖先多切一刀：菜单里露一截，裁剪带里露得更少。
      rowsCut: rows.filter((r) => r.inMenu > 0 && r.inClip < r.inMenu - 0.5).length,
      optionCount: rows.length,
    };
  }, { menuSel: MENU, optSel: OPTION, bodySel: BODY, tag });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shots = (n) => page.screenshot({ path: join(EVIDENCE, `${n}.png`) });
const all = [];

async function openMenu({ navigate = true } = {}) {
  if (navigate) await page.goto(`${WEB}/app/team`);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  await page.waitForSelector(`[role="dialog"] ${TRIGGER}`, { timeout: 15_000 });
  await page.click(TRIGGER);
  await page.waitForSelector(MENU, { timeout: 10_000 });
  await page.waitForTimeout(300); // 等 anim-pop 收尾
  const box = await page.locator(MENU).boundingBox();
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const insideTop = { x: box.x + box.width / 2, y: box.y + 6 }; // 菜单最上沿内侧
  return { box, middle, insideTop };
}

/** 真实滚轮：逐次小步（贴近触控板），返回步数。 */
async function wheelUntil(page, at, dy, stopFn, maxSteps = 40, step = 120) {
  await page.mouse.move(at.x, at.y);
  for (let i = 1; i <= maxSteps; i += 1) {
    await page.mouse.wheel(0, Math.sign(dy) * step);
    await page.waitForTimeout(40);
    if (await stopFn()) return i;
  }
  return maxSteps;
}

await seed(page);

// ══ 第一段：待验分支上的真实滚轮行为 ══════════════════════════════════════
{
  const at = await openMenu();
  const s0 = await snap(page, 'fixed/open');
  all.push(s0);
  await shots('01-fixed-open');
  record(s0.menuScroll.top === 0 && s0.firstRow.inClip >= s0.firstRow.h - 0.5,
    'fixed: 打开即停在列表顶端，首行「未设置模型」完整可见',
    `scrollTop=${s0.menuScroll.top} 首行 inClip=${s0.firstRow.inClip}/${s0.firstRow.h} maxHeight=${s0.maxHeight}`);

  // 真实滚轮划到底
  const downSteps = await wheelUntil(page, at.middle, 400, async () => {
    const t = await page.evaluate((s) => document.querySelector(s).scrollTop, MENU);
    const max = await page.evaluate((s) => { const e = document.querySelector(s); return e.scrollHeight - e.clientHeight; }, MENU);
    return t >= max - 1;
  });
  const sDown = await snap(page, 'fixed/wheel-down-bottom');
  all.push(sDown);
  await shots('02-fixed-wheel-down-bottom');
  record(sDown.menuScroll.top >= sDown.menuScroll.max - 1 && sDown.lastRow.inClip >= sDown.lastRow.h - 0.5,
    'fixed: 真实滚轮能划到列表底端，末行完整可见',
    `划了 ${downSteps} 步 → scrollTop=${sDown.menuScroll.top}/${sDown.menuScroll.max}`);

  // 真实滚轮从底端划回顶端——用户说的「上端划得过去」
  const upSteps = await wheelUntil(page, at.middle, -400, async () =>
    (await page.evaluate((s) => document.querySelector(s).scrollTop, MENU)) === 0);
  const sUp = await snap(page, 'fixed/wheel-up-top');
  all.push(sUp);
  await shots('03-fixed-wheel-up-top');
  record(sUp.menuScroll.top === 0,
    'fixed: 从底端用真实滚轮能划回列表顶端',
    `划了 ${upSteps} 步 → scrollTop=${sUp.menuScroll.top}`);
  record(sUp.firstRow.inClip >= sUp.firstRow.h - 0.5 && sUp.rowsCut === 0 && sUp.rowsClippedAway === 0,
    'fixed: 划回顶端后首行完整可见、没有行被弹窗体上沿吃掉（「上端划不过去」不复现）',
    `首行 inClip=${sUp.firstRow.inClip}/${sUp.firstRow.h} 被祖先裁没=${sUp.rowsClippedAway} 被多切=${sUp.rowsCut}`);

  // 真实点击一条**非当前选中**的行（当前是「未设置模型」），不做任何程序化滚动
  const targetName = (await page.locator(OPTION).nth(3).evaluate((el) =>
    el.querySelector('[class$="-row-name"]')?.textContent?.trim() ?? el.textContent.trim()));
  const before = (await page.textContent(TRIGGER)).trim();
  let clickErr = null;
  try {
    await page.locator(OPTION).nth(3).click({ timeout: 5_000 });
  } catch (err) { clickErr = String(err).split('\n')[0]; }
  const after = (await page.textContent(TRIGGER)).trim();
  await shots('04-fixed-click-near-top');
  record(clickErr == null && after === targetName,
    'fixed: 划回顶端后，顶部第 4 行可用真实点击选中并正确回显',
    clickErr ?? `「${before}」→「${after}」（期望「${targetName}」）`);

  // 反复上下划，菜单盒与弹窗体都不该动
  await openMenu();
  const box0 = await page.locator(MENU).boundingBox();
  await page.mouse.move(at.middle.x, at.middle.y);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, 300); await page.mouse.wheel(0, -300); }
  await page.waitForTimeout(200);
  const box1 = await page.locator(MENU).boundingBox();
  const sChurn = await snap(page, 'fixed/churn');
  all.push(sChurn);
  record(Math.abs(box1.y - box0.y) < 0.5 && sChurn.body.scrollTop === 0,
    'fixed: 菜单内反复上下划，菜单盒与弹窗体都不移动（无滚动链）',
    `菜单 y ${box0.y}→${box1.y}；body scrollTop=${sChurn.body.scrollTop} body 可滚=${sChurn.body.scrollable}`);
}

// ══ 第二段：改动前对照（把唯一那行 max-height 还原成 300px）══════════════
{
  // 先导航再注入：样式标签是挂在当前文档上的，先注入会被随后的 goto 冲掉。
  await page.goto(`${WEB}/app/team`);
  await page.addStyleTag({ content: `${MENU}{max-height:${PREFIX_MAXHEIGHT}px !important}` });
  const at = await openMenu({ navigate: false });
  const s0 = await snap(page, 'prefix/open');
  all.push(s0);
  await shots('05-prefix-open');
  record(s0.menu.top < s0.body.top - 0.5 && s0.rowsCut > 0,
    `prefix: 改动前打开时菜单顶越出弹窗体上沿，顶部若干行被裁（症状本体）`,
    `菜单盒 ${s0.menu.top}..${s0.menu.bottom} 弹窗体可视 ${s0.body.top}..${s0.body.bottom} 被裁行=${s0.rowsCut} 首行可见高=${s0.firstRow.inClip}/${s0.firstRow.h}`);

  // 光标压在菜单可见区最上沿（用户手会放的地方），一路往上划
  await wheelUntil(page, at.insideTop, -400, async () => false, 10);
  const sTop = await snap(page, 'prefix/wheel-up-at-top');
  all.push(sTop);
  await shots('06-prefix-wheel-up-at-top');
  record(sTop.rowsCut >= s0.rowsCut && sTop.menuScroll.top === 0,
    'prefix: 在顶部往上划，被裁的行一步都回不来（「上端划不过去」）',
    `被祖先裁没 ${s0.rowsClippedAway}→${sTop.rowsClippedAway}，被多切 ${s0.rowsCut}→${sTop.rowsCut}；scrollTop=${sTop.menuScroll.top} 首行可见高=${sTop.firstRow.inClip}/${sTop.firstRow.h}`);

  // 划到底再一路划回顶：真实用户能做的所有操作
  await wheelUntil(page, at.middle, 400, async () => {
    const [t, max] = await page.evaluate((s) => { const e = document.querySelector(s); return [e.scrollTop, e.scrollHeight - e.clientHeight]; }, MENU);
    return t >= max - 1;
  });
  await wheelUntil(page, at.middle, -400, async () =>
    (await page.evaluate((s) => document.querySelector(s).scrollTop, MENU)) === 0, 40);
  const sBack = await snap(page, 'prefix/wheel-back-to-top');
  all.push(sBack);
  await shots('07-prefix-wheel-back-to-top');
  record(sBack.rowsClippedAway > 0 && sBack.firstRow.inClip === 0,
    'prefix: 划到底再划回顶端，被裁的行依然不可见（永远不可达）',
    `scrollTop=${sBack.menuScroll.top}/${sBack.menuScroll.max} 被祖先裁没=${sBack.rowsClippedAway} 首行可见高=${sBack.firstRow.inClip} 该位置命中=${sBack.firstRow.hit}`);

  // 真实点击被裁的行
  let prefixClickErr = null;
  try { await page.locator(OPTION).first().click({ timeout: 4_000 }); }
  catch (err) { prefixClickErr = String(err).split('\n')[0]; }
  record(prefixClickErr != null,
    'prefix: 被裁的行用真实点击点不中',
    prefixClickErr ?? '竟然点中了（探针无效）');
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({
  probe: 'xmon-40-top-scroll', at: new Date().toISOString(), web: WEB, modelCount: MODEL_COUNT,
  prefixMaxHeight: PREFIX_MAXHEIGHT, checks, snapshots: all, pageErrors: errors,
}, null, 2));
await browser.close();
console.log(`\n${checks.length - failed.length}/${checks.length} checks ok`);
console.log(`evidence: ${EVIDENCE}`);
process.exitCode = failed.length === 0 ? 0 : 1;