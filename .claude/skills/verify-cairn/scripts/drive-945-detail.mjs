#!/usr/bin/env node
// verify-cairn 定制 probe（#945 detail-a 域施工）— live 栈真用户路径 +
// detail.css 清零后 live-only 面的运行时机制断言 + 渲染对比度实测。
// 栈必须已在跑（launch.mjs；坐标取 VERIFY_RUN_DIR/ports.json，worktree
// 车道传 VERIFY_REPO_ROOT）。
//
// 为什么需要 live：fixture 面盖不住的 detail.css 迁移面——
//   1. composer 真 textarea（Textarea 件收编 + COMPOSER_INPUT 中和串：
//      48px 基高 / 13·15·0 内衬 / Inter 栈 / tabular-nums / 无框无环）
//   2. live 行披露钮形态（button.chat-streaming：24px 命中盒 + 20px 内容
//      盒 + 2px 负 margin 律，#885；fixture 只有 span 形态）
//   3. 任务元信息块（task-meta live 空态面，#476）
//   4. StatusChip live 相位链（data-tone 载体）+ 发送钮 --ready 翻面
//   5. 停止钮 live 面（streaming 时 composer-stop 在场）
//
// 前置（build 在飞段）：stop-button.md 的 seed 配方——stub LLM 门控轮
// （STUB_PORT=8919）+ provider/agent/api-key/project/todo + 真 daemon。
// 无 build 段（A/B）只需 launch.mjs + drive.mjs new-task（或本脚本自建
// todo）。--skip-build 跳过 C 段（无 daemon/stub 时的降级跑法）。
//
// 证据（截图 + result.json + contrast.json）落 VERIFY_EVIDENCE_DIR。
// 任一断言失败退出码 1。口径与 apps/web/playwright.config.ts 一致：1440×732。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const portsFile = join(RUN_DIR, 'ports.json');
let stack;
try {
  stack = JSON.parse(readFileSync(portsFile, 'utf8'));
} catch {
  console.error(`无栈：${portsFile} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;
const SKIP_BUILD = process.argv.includes('--skip-build');
// 运行中 todo（C 段）：env 传 id，缺省取最近一个非 closed todo。
const RUNNING_ID = process.env.RUNNING_ID ?? null;

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-945-detail`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const artifacts = [];
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};
const shot = async (page, name) => {
  const file = join(EVIDENCE, name);
  await page.screenshot({ path: file });
  artifacts.push(name);
  console.log(`shot  ${name}`);
};
const api = async (path, options = {}) => {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
};

// ---- WCAG 2.x contrast（better-colors：实测不许估） ----
const parseRgb = (c) => {
  const srgb = c.startsWith('color(srgb');
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) return null;
  const scale = srgb ? 255 : 1;
  return { r: m[0] * scale, g: m[1] * scale, b: m[2] * scale, a: m.length > 3 ? m[3] : 1 };
};
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
});
const lum = (c) => {
  const f = (x) => {
    const s = x / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
};
const contrastRows = [];

const probeContrast = async (page, sel, label, floor) => {
  const pair = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el == null) return null;
    const parse = (v) => {
      const srgb = v.startsWith('color(srgb');
      const m = v.match(/[\d.]+/g)?.map(Number);
      if (m == null || m.length < 3) return null;
      const scale = srgb ? 255 : 1;
      return {
        r: m[0] * scale,
        g: m[1] * scale,
        b: m[2] * scale,
        a: m.length > 3 ? m[3] : 1,
      };
    };
    const cs = getComputedStyle(el);
    const layers = [];
    let node = el;
    while (node != null && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c != null && c.a > 0) {
        layers.push(c);
        if (c.a === 1) break;
      }
      node = node.parentElement;
    }
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor) ?? {
      r: 30,
      g: 27,
      b: 22,
      a: 1,
    };
    let bg = rootBg;
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      bg = {
        r: layers[i].r * layers[i].a + bg.r * (1 - layers[i].a),
        g: layers[i].g * layers[i].a + bg.g * (1 - layers[i].a),
        b: layers[i].b * layers[i].a + bg.b * (1 - layers[i].a),
      };
    }
    return { fg: parse(cs.color), bg };
  }, sel);
  if (pair == null || pair.fg == null) {
    check(false, `contrast ${label}: element/color missing`);
    return;
  }
  const fg = pair.fg.a < 1 ? over(pair.fg, pair.bg) : pair.fg;
  const r = ratio(fg, pair.bg);
  contrastRows.push({ label, sel, ratio: r, floor, pass: r >= floor });
  check(r >= floor, `contrast ${label}: ${r}:1 >= ${floor}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

// ================= A. live 详情基础面 =================
// 取（或建）一个探针 todo：优先 running，其次任一 todo。
let todoId = RUNNING_ID;
if (todoId == null) {
  const teams = await api('/api/teams');
  const teamId = teams[0]?.id;
  const todos = await api(`/api/teams/${teamId}/todos`);
  todoId = todos.find((t) => t.phase !== 'closed')?.id ?? todos[0]?.id;
}
if (todoId == null) {
  console.error('无 todo 可用——先跑 drive.mjs new-task 或按 stop-button.md seed');
  process.exit(1);
}

await page.goto(`${WEB}/app/todo/${todoId}`);
await page.waitForSelector('[data-testid="detail-head"]', { timeout: 15_000 });

// A1 壳 testid 载体在场（#910 二级载体落 DOM 的运行时真值）
for (const testid of [
  'detail-main',
  'detail-body',
  'detail-center',
  'detail-head',
  'composer-card',
  'transcript-col',
]) {
  const n = await page.locator(`[data-testid="${testid}"]`).count();
  check(n >= 1, `A1 carrier [data-testid=${testid}] present (${n})`);
}

// A2 StatusChip live：data-tone 载体 + chip 文案
const tone = await page
  .locator('.detail-chip [data-tone]')
  .first()
  .getAttribute('data-tone');
check(
  ['idle', 'plan', 'confirm', 'done', 'failed'].includes(tone),
  `A2 StatusChip data-tone carrier (${tone})`,
);
await shot(page, '01-detail-live.png');

// A3 composer 真 textarea（Textarea 件 + COMPOSER_INPUT 中和串）
const ta = page.locator('[data-testid="composer-card"] textarea');
const taCount = await ta.count();
if (taCount === 1) {
  const geo = await ta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      pt: cs.paddingTop,
      pl: cs.paddingLeft,
      pb: cs.paddingBottom,
      fs: cs.fontSize,
      lh: cs.lineHeight,
      ff: cs.fontFamily,
      fvn: cs.fontVariantNumeric,
      bw: cs.borderTopWidth,
      outline: cs.outlineStyle,
      resize: cs.resize,
      fsizing: cs.fieldSizing,
      bg: cs.backgroundColor,
    };
  });
  // 空稿基高 48（3×16 行盒）；grow 由 wire 的 inline height 承载
  check(geo.h === 48, `A3 textarea base height 48 (${geo.h})`);
  check(geo.pt === '13px' && geo.pl === '15px' && geo.pb === '0px', `A3 padding 13/15/0 (${geo.pt} ${geo.pl} ${geo.pb})`);
  check(geo.fs === '14px' && geo.lh === '16px', `A3 font 14/16 (${geo.fs}/${geo.lh})`);
  check(/inter/i.test(geo.ff), `A3 Inter stack (${geo.ff.slice(0, 40)}…)`);
  check(geo.fvn.includes('tabular-nums'), `A3 tabular-nums (${geo.fvn})`);
  check(geo.bw === '0px', `A3 borderless (${geo.bw})`);
  check(geo.resize === 'none', `A3 resize none (${geo.resize})`);
  check(geo.fsizing === 'fixed', `A3 field-sizing fixed (${geo.fsizing})`);

  // A4 draft → send 钮翻品牌实底（XMON-55 P5 live 翻面）
  await ta.fill('945 探针草稿');
  await page.waitForTimeout(200);
  const readyBg = await page
    .locator('.composer-send')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const cardButton = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--card-button').trim(),
  );
  check(
    readyBg !== '' && readyBg !== 'rgba(0, 0, 0, 0)',
    `A4 send ready paints (${readyBg} vs --card-button ${cardButton})`,
  );
  await probeContrast(page, '.composer-send', 'send ready on-accent/card-button', 4.5);
  await shot(page, '02-composer-draft.png');
  await ta.fill('');
} else {
  check(false, `A3 live textarea present (count=${taCount})`);
}

// A5 chip popover live 开合（FloatingShell wrap 锚定）
await page.locator('[data-testid="detail-head"] button[aria-expanded]').click();
await page.waitForTimeout(300);
const popoverOpen = await page.getByRole('dialog', { name: '任务分配' }).isVisible().catch(() => false);
check(popoverOpen, 'A5 chip popover opens (role=dialog 任务分配)');
await shot(page, '03-chip-popover.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// A6 user-menu floating 形态（Popover Positioner + PANEL_FLOATING 皮肤）
const userTrigger = page.locator('.sidebar-user').first();
if ((await userTrigger.count()) > 0) {
  await userTrigger.click();
  await page.waitForTimeout(300);
  const menuGeo = await page.locator('.user-menu').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { pos: cs.position, w: Math.round(r.width), pad: cs.paddingTop, shadow: cs.boxShadow };
  });
  check(menuGeo.pos === 'relative' && menuGeo.w === 224, `A6 floating menu 224w relative (${JSON.stringify(menuGeo)})`);
  await probeContrast(page, '.user-menu-row', 'menu row secondary/popover', 4.5);
  await shot(page, '04-user-menu-live.png');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}

// ================= B. 运行中面（stub build 在飞） =================
if (!SKIP_BUILD) {
  if (RUNNING_ID == null) {
    console.log('B 段跳过：未给 RUNNING_ID（运行中 todo id）');
  } else {
    await page.goto(`${WEB}/app/todo/${RUNNING_ID}`);
    const liveRow = page.getByTestId('live-row');
    await liveRow.first().waitFor({ timeout: 60_000 }).catch(() => {});
    const isButton = await liveRow
      .first()
      .evaluate((el) => el.tagName === 'BUTTON')
      .catch(() => false);
    check(isButton, 'B1 live row is the disclosure button form');
    if (isButton) {
      const geo = await liveRow.first().evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          borderH: Math.round(r.height),
          contentH: Math.round(r.height - 4),
          pt: cs.paddingTop,
          mt: cs.marginTop,
          bg: cs.backgroundColor,
          fs: cs.fontSize,
          cursor: cs.cursor,
          h: cs.height,
        };
      });
      // #885：border box 24（命中区），padding 2 + 负 margin 2 → 相邻行零位移
      check(geo.borderH === 24, `B2 button row border-box 24 (${geo.borderH})`);
      check(geo.pt === '2px', `B2 padding-top 2 (${geo.pt})`);
      check(geo.mt === '-2px', `B2 margin-top -2 (${geo.mt})`);
      check(geo.bg === 'rgba(0, 0, 0, 0)', `B2 transparent bg (${geo.bg})`);
      check(geo.cursor === 'pointer', `B2 cursor pointer (${geo.cursor})`);
      const secsVisible = await page.getByTestId('live-row').first().getByText(/^\d+s$/).count();
      check(secsVisible >= 0, `B3 secs slot present (${secsVisible})`);
      const spinnerCount = await liveRow.first().locator('[aria-hidden="true"]').count();
      check(spinnerCount >= 1, `B4 spinner root in row (${spinnerCount})`);
    }
    const stopCount = await page.locator('.composer-stop').count();
    check(stopCount === 1, `B5 composer stop present while streaming (${stopCount})`);
    await shot(page, '05-live-row-button.png');
  }
}

// ================= C. 对比度（live 面渲染对） =================
await page.goto(`${WEB}/app/todo/${todoId}`);
await page.waitForSelector('[data-testid="detail-head"]', { timeout: 15_000 });
await probeContrast(page, '[data-testid="detail-title"]', 'head title primary/surface', 4.5);
await probeContrast(page, '.detail-chip [data-tone]', 'status chip tone pair', 4.5);
await probeContrast(page, '[data-testid="composer-placeholder"], [data-testid="composer-card"] textarea', 'composer ink', 3);

writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({ checks, artifacts, failures }, null, 1));
writeFileSync(join(EVIDENCE, 'contrast.json'), JSON.stringify(contrastRows, null, 1));
await browser.close();
console.log(`\ndrive-945-detail: ${checks.length} checks, failures ${failures} → ${EVIDENCE}`);
process.exit(failures > 0 ? 1 : 0);
