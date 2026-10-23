#!/usr/bin/env node
// verify-cairn 定制 probe（#943 board/sidebar 域施工）— live 栈真用户路径 +
// better-colors 对比度实测（渲染对/token 解析对，双主题）+ board.css 清零的
// 运行时机制断言。栈必须已在跑（launch.mjs；坐标取 VERIFY_RUN_DIR/ports.json，
// worktree 车道传 VERIFY_REPO_ROOT）。
//
// 前置：drive.mjs new-task 已跑过（库里有 1 卡 + 默认项目）；本 probe 自己再
// 经公开 REST 建第二个项目（repo 维度要 ≥2 选项才走得进三态 mixed）。
//
// 检查面：
//   A. 板面/侧栏渲染与几何（4 列、轨道 ≥280、seam 同色、侧栏 240、
//      卡面项目徽标皮肤在场——A5 是 Spec 轴评审抓出的漏迁失败方式）
//   B. 裸控件收编实物（行钮 data-slot=button / data-variant=ghost）
//   C. 交互真路径（hover pill 染色、折叠/rail、项目组收展、用户菜单开合、
//      筛选面板三态 checkbox mixed→true→false、生效条 chip 清除、计数徽章）
//   D. board.css 清零运行时机制（样式表枚举：退役选择器零规则；
//      body[data-board-dragging] 律在 motion.css 在场）
//   E. 对比度实测（WCAG 2.x 相对亮度公式，文本 ≥4.5、非文本 ≥3.0，双主题）
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

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-943-board-sidebar`);
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

// ---- WCAG 2.x contrast（better-colors：实测不许估） ----
const parseRgb = (c) => {
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) return null;
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
};
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
});
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (c1, c2) => {
  const l1 = lum(c1);
  const l2 = lum(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** 页内取值：渲染元素对（selector 化 computed color）+ token 解析对
 *  （probe-div 走 var() 解析，card-press.spec resolveVar 同款）。 */
const measurePairs = (page) =>
  page.evaluate(() => {
    const resolveVar = (decl, value) => {
      const probe = document.createElement('div');
      probe.style.setProperty(decl, value);
      document.body.append(probe);
      const out = getComputedStyle(probe).getPropertyValue(decl).trim();
      probe.remove();
      return out;
    };
    const cs = (el, pseudo) => getComputedStyle(el, pseudo);
    const q = (sel, root = document) => root.querySelector(sel);
    const canvas = resolveVar('color', 'var(--background)');
    const pairs = [];
    const push = (face, fg, bg, kind) => pairs.push({ face, fg, bg, kind, canvas });

    const aside = q('aside');
    const asideBg = cs(aside).backgroundColor;
    // 导航行文字（定时 link）vs 侧栏底
    const navLink = [...aside.querySelectorAll('nav a')].find((a) =>
      a.textContent.includes('定时'),
    );
    if (navLink) push('sidebar-nav-text', cs(navLink).color, asideBg, 'text');
    // 选中行：pill(::before rgba) 合成侧栏底 vs 行墨
    const sel = aside.querySelector('nav a[aria-current="page"]');
    if (sel) {
      const pill = cs(sel, '::before').backgroundColor;
      push('sidebar-selected-pill', cs(sel).color, `${pill}||${asideBg}`, 'text');
    }
    // ⌘K 角标（透明底骑侧栏）
    const kbd = [...aside.querySelectorAll('button span')].find(
      (s) => s.textContent.trim() === '⌘K',
    );
    if (kbd) push('sidebar-kbd', cs(kbd).color, asideBg, 'text');
    // 列头文字 vs 列底
    const col = q('[data-column="todo"]');
    if (col) {
      const name = col.querySelector('header span:nth-child(2)');
      if (name) push('column-header', cs(name).color, cs(col).backgroundColor, 'text');
    }
    // 卡标题 vs 卡底
    const card = q('[data-todo-id]');
    if (card) {
      const title = card.querySelector('h3 a');
      if (title) push('card-title', cs(title).color, cs(card).backgroundColor, 'text');
    }
    // 筛选钮（ghost）vs 顶栏底
    const trigger = q('button[aria-label="筛选"]');
    const header = q('[data-route="board"] header');
    if (trigger && header) {
      push('filter-trigger', cs(trigger).color, cs(header).backgroundColor, 'text');
    }
    // focus 环 vs 页面底（非文本 3:1）
    push(
      'focus-ring',
      resolveVar('color', 'var(--focus-ring)'),
      resolveVar('color', 'var(--background)'),
      'ui',
    );
    // token 解析对（态色/双面件：不在静息 DOM 上的角色）
    push(
      'checkbox-check',
      resolveVar('color', 'var(--primary-foreground)'),
      resolveVar('color', 'var(--card-button)'),
      'text',
    );
    push(
      'invert-link',
      resolveVar('color', 'var(--card-button)'),
      resolveVar('color', 'var(--popover)'),
      'text',
    );
    push(
      'project-avatar',
      resolveVar('color', 'var(--project-avatar-fg)'),
      resolveVar('color', 'var(--project-avatar-bg)'),
      'text',
    );
    push(
      'notify-title',
      resolveVar('color', 'var(--foreground)'),
      resolveVar('color', 'var(--surface-secondary)'),
      'text',
    );
    push(
      'notify-body',
      resolveVar('color', 'var(--muted-foreground)'),
      resolveVar('color', 'var(--surface-secondary)'),
      'text',
    );
    push(
      'option-count',
      resolveVar('color', 'var(--muted-foreground)'),
      resolveVar('color', 'var(--popover)'),
      'text',
    );
    push(
      'badge-attention',
      resolveVar('color', 'var(--badge-attention-fg)'),
      resolveVar('color', 'var(--badge-attention)'),
      'text',
    );
    push(
      'filter-chip',
      resolveVar('color', 'var(--background)'),
      resolveVar('color', 'var(--foreground)'),
      'text',
    );
    push(
      'drop-tint-border',
      resolveVar('color', 'var(--drop-tint-border)'),
      resolveVar('color', 'var(--color-column, var(--column))'),
      'ui',
    );
    return pairs;
  });

const scorePairs = (pairs) =>
  pairs.map((p) => {
    let fg = parseRgb(p.fg);
    let bg = parseRgb(p.bg);
    if (fg == null || bg == null) return { ...p, ratio: null, pass: false, note: 'unparsable' };
    if (p.bg.includes('||')) {
      // 合成面：rgba pill over 底色
      const [pillColor, baseColor] = p.bg.split('||');
      const pill = parseRgb(pillColor);
      const base = parseRgb(baseColor);
      bg = over(pill, base);
    }
    // 透明/半透明底合成到画布（--background）：transparent 不是黑色
    const canvas = parseRgb(p.canvas);
    if (bg.a < 1 && canvas != null) bg = over(bg, canvas);
    if (fg.a < 1 && canvas != null) fg = over(fg, canvas);
    const r = ratio(fg, bg);
    const floor = p.kind === 'text' ? 4.5 : 3.0;
    return {
      ...p,
      fgRgb: `rgb(${Math.round(fg.r)} ${Math.round(fg.g)} ${Math.round(fg.b)})`,
      bgRgb: `rgb(${Math.round(bg.r)} ${Math.round(bg.g)} ${Math.round(bg.b)})`,
      ratio: Math.round(r * 100) / 100,
      floor,
      pass: r >= floor,
    };
  });

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

const browser = await chromium.launch();
const contrast = {};

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    colorScheme: theme,
  });
  await context.addInitScript(
    ([t]) => localStorage.setItem('cairn-theme', t),
    [theme],
  );
  const page = await context.newPage();
  await page.goto(`${WEB}/app`);
  await page.getByRole('complementary').waitFor({ state: 'visible', timeout: 20_000 });

  if (theme === 'dark') {
    // ---- A. 渲染与几何 ----
    check((await page.locator('[data-column]').count()) === 4, 'A1 看板 4 列在场');
    const tracks = await page
      .getByTestId('board-scroller')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    const widths = tracks.split(' ').map((v) => Number.parseFloat(v));
    check(widths.length === 4 && widths.every((w) => w >= 279), `A2 轨道 4 段 ≥280（实测 ${tracks}）`);
    // A5 = 本票实战抓出的失败方式（Spec 轴评审）：.project-avatar 规则随
    // board.css 删除后，消费面若漏迁工具类，卡面首字母退化成裸字——probe
    // 与 e2e 都不天然覆盖（无既有断言面），故显式钉渲染皮肤。
    const avatar = await page.evaluate(() => {
      const el = document.querySelector('[data-todo-id] .project-avatar');
      if (el == null) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, w: el.getBoundingClientRect().width };
    });
    check(
      avatar != null && avatar.bg !== 'rgba(0, 0, 0, 0)' && avatar.w === 16,
      `A5 卡面项目徽标带皮（bg=${avatar?.bg} w=${avatar?.w}；前置=drive new-task 已落卡）`,
    );

    const seam = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const header = document.querySelector('[data-route="board"] header');
      return {
        seamColor: getComputedStyle(aside).borderRightColor,
        topColor: getComputedStyle(header).borderBottomColor,
        asideW: aside.getBoundingClientRect().width,
      };
    });
    check(seam.seamColor === seam.topColor, `A3 seam 与顶栏分隔线同色（${seam.seamColor}）`);
    check(seam.asideW === 240, `A4 侧栏 240px（实测 ${seam.asideW}）`);

    // ---- B. 裸控件收编实物 ----
    const slots = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const btns = [...aside.querySelectorAll('button')];
      return {
        total: btns.length,
        // PopoverTrigger render 合成会把 data-slot 覆成 popover-trigger
        // （载体层行为）——判据 = 槽属性在场，不是槽值恒 button
        withSlot: btns.filter((b) => b.dataset.slot != null).length,
        bare: btns.filter((b) => b.dataset.slot == null).length,
      };
    });
    check(
      slots.total > 0 && slots.bare === 0,
      `B1 侧栏按钮全数带 data-slot 件槽（${slots.withSlot}/${slots.total}，裸 ${slots.bare}）`,
    );

    // ---- C. 交互真路径 ----
    // hover pill 染色（::before 从透明到有值）
    const pillOf = (loc) =>
      loc.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
    const sched = page.getByRole('link', { name: '定时' });
    const rest = await pillOf(sched);
    await sched.hover();
    await page.waitForTimeout(300);
    const hovered = await pillOf(sched);
    check(rest !== hovered && hovered !== 'rgba(0, 0, 0, 0)', `C1 行 hover pill 染色（${rest} → ${hovered}）`);
    await page.mouse.move(700, 400);

    // 折叠 → rail → 展开
    await page.getByRole('button', { name: '收起侧边栏' }).click();
    await page.waitForTimeout(200);
    const railW = await page.evaluate(
      () => document.querySelector('aside').getBoundingClientRect().width,
    );
    check(railW === 40, `C2 折叠成 40px rail（实测 ${railW}）`);
    await shot(page, `03-rail-${theme}.png`);
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    await page.waitForTimeout(200);
    const backW = await page.evaluate(
      () => document.querySelector('aside').getBoundingClientRect().width,
    );
    check(backW === 240, `C3 展开回 240px（实测 ${backW}）`);

    // 项目组收展（aria-expanded 载体）
    const groupBtn = page.getByRole('button', { name: '收起项目' });
    await groupBtn.click();
    await page.waitForTimeout(150);
    check(
      await page.getByRole('button', { name: '展开项目' }).isVisible(),
      'C4 项目组收起（aria-label 翻到 展开项目）',
    );
    check(
      (await page.getByRole('link', { name: '新建项目' }).count()) === 0 ||
        !(await page.getByRole('link', { name: '新建项目' }).isVisible()),
      'C4b 收起后 新建项目 行不可见',
    );
    await page.getByRole('button', { name: '展开项目' }).click();
    await page.waitForTimeout(150);
    check(await page.getByRole('link', { name: '新建项目' }).isVisible(), 'C4c 展开后行回场');

    // 用户菜单开合
    await page.getByRole('button', { name: 'Owner' }).click();
    await page.waitForTimeout(300);
    check(
      await page.getByRole('dialog', { name: '用户菜单' }).isVisible(),
      'C5 用户 chip 开出菜单（dialog/用户菜单）',
    );
    await shot(page, `05-user-menu-${theme}.png`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(
      !(await page.getByRole('dialog', { name: '用户菜单' }).isVisible().catch(() => false)),
      'C5b Esc 关菜单',
    );

    // ---- D. board.css 清零运行时机制 ----
    const cssScan = await page.evaluate(() => {
      const retired = [
        '.board-shell',
        '.board-scroller',
        '.board-notify-banner',
        '.project-avatar',
        '.board-drag-card',
        '.board-dragging',
      ];
      const hits = [];
      let draggingLaw = false;
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (list) => {
          for (const rule of list) {
            if (rule.cssRules) walk(rule.cssRules);
            const sel = rule.selectorText;
            if (sel == null) continue;
            if (sel.includes('data-board-dragging')) draggingLaw = true;
            // 合法形态排除：① chief.css 的 dock portal 复合规则（.board-shell
            // 是运行时钩子，规则住址 chief.css = #950 域）；② Tailwind
            // arbitrary variant 工具类选择器（.\[...\] 转义形，如
            // [&>.project-avatar]:relative 的编译产物——工具类不是 per-face）
            if (sel.includes('[data-base-ui-portal]')) continue;
            if (sel.includes('\\[')) continue;
            for (const cls of retired) {
              // 类选择器形态命中（.board-shell 后不接字母数字连字符）
              const re = new RegExp(`\\${cls}(?![\\w-])`);
              if (re.test(sel)) hits.push(sel);
            }
          }
        };
        walk(rules);
      }
      return { hits, draggingLaw };
    });
    check(cssScan.hits.length === 0, `D1 退役选择器零规则（命中 ${cssScan.hits.length}：${cssScan.hits.slice(0, 3).join(' | ')}）`);
    check(cssScan.draggingLaw, 'D2 body[data-board-dragging] 手势律在场（motion.css）');

    // ---- 筛选面板三态（需要 ≥2 项目：REST 建第二个） ----
    const projects = await api('GET', '/api/projects');
    const teams = await api('GET', '/api/teams');
    const teamId = Array.isArray(teams.body) ? teams.body[0]?.id : null;
    if (Array.isArray(projects.body) && projects.body.length < 2 && teamId) {
      await api('POST', '/api/projects', {
        name: 'verify-943-second',
        teamId,
        repoKind: 'hosted',
        repoName: 'verify-943-second',
      });
      await page.reload();
      await page.getByRole('complementary').waitFor({ state: 'visible', timeout: 20_000 });
    }
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.waitForTimeout(300);
    const dialog = page.getByRole('dialog', { name: '筛选' });
    check(await dialog.isVisible(), 'C6 筛选钮开出面板（dialog/筛选）');
    const allBox = dialog.locator('section[data-dimension="repo"]').getByRole('checkbox');
    check(await allBox.isVisible(), 'C6b repo 维度全选 checkbox 在场（role=checkbox）');
    check(
      (await allBox.getAttribute('aria-checked')) === 'false',
      'C6c 空选 = aria-checked false',
    );
    const firstOption = dialog.locator('section[data-dimension="repo"] [data-project]').first();
    await firstOption.click();
    await page.waitForTimeout(200);
    const mixed = await allBox.getAttribute('aria-checked');
    const optionCount = await dialog.locator('section[data-dimension="repo"] [data-project]').count();
    check(
      optionCount < 2 || mixed === 'mixed',
      `C7 单选后全选行 aria-checked=${mixed}（选项 ${optionCount}，≥2 时必须 mixed）`,
    );
    const chip = page.locator('header [data-dimension="repo"]');
    check(await chip.isVisible(), 'C8 顶栏生效筛选条现身（header 内 data-dimension chip）');
    check(
      (await page.getByTestId('filter-count').textContent()) === '1',
      'C8b 触发钮计数徽章 = 1',
    );
    await shot(page, `04-filter-popover-${theme}.png`);
    const beforeAll = await allBox.getAttribute('aria-checked');
    await allBox.click();
    await page.waitForTimeout(200);
    const afterAll = await allBox.getAttribute('aria-checked');
    if (beforeAll === 'true') {
      // 单选项库：点开前已满选 → 本击 = 清本维
      check(afterAll === 'false', `C9 满选点全选 = 清本维（${beforeAll} → ${afterAll}）`);
    } else {
      check(afterAll === 'true', `C9 非满选点全选 = 全选（${beforeAll} → ${afterAll}）`);
      await allBox.click();
      await page.waitForTimeout(200);
      check(
        (await allBox.getAttribute('aria-checked')) === 'false',
        'C9b 满选再点 = 清本维（aria-checked false）',
      );
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // chip 清除（真用户路径：点条清维度）
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await page.waitForTimeout(300);
    }
    check(
      (await page.locator('header [data-dimension]').count()) === 0,
      'C10 生效筛选条清空',
    );

    await shot(page, `02-board-${theme}.png`);
  } else {
    await shot(page, `06-board-${theme}.png`);
    await page.getByRole('button', { name: '筛选', exact: true }).click();
    await page.waitForTimeout(300);
    await shot(page, `07-filter-popover-${theme}.png`);
    await page.keyboard.press('Escape');
  }

  // ---- E. 对比度实测 ----
  const rows = scorePairs(await measurePairs(page));
  contrast[theme] = rows;
  const bad = rows.filter((r) => !r.pass);
  check(bad.length === 0, `E-${theme} 对比度 ${rows.length} 对全过（未过 ${bad.length}：${bad.map((b) => `${b.face}=${b.ratio}`).join(', ')}）`);
  await context.close();
}

await browser.close();

writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ probe: 'drive-943-board-sidebar', checks, artifacts, failures }, null, 2)}\n`,
);
writeFileSync(join(EVIDENCE, 'contrast.json'), `${JSON.stringify(contrast, null, 2)}\n`);
console.log(`evidence:${EVIDENCE}`);
console.log(failures === 0 ? 'drive-943-board-sidebar:PASS' : `drive-943-board-sidebar:FAIL(${failures})`);
process.exit(failures === 0 ? 0 : 1);
