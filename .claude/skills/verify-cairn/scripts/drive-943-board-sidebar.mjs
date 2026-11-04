#!/usr/bin/env node

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

    const navLink = [...aside.querySelectorAll('nav a')].find((a) =>
      a.textContent.includes('定时'),
    );
    if (navLink) push('sidebar-nav-text', cs(navLink).color, asideBg, 'text');

    const sel = aside.querySelector('nav a[aria-current="page"]');
    if (sel) {
      const pill = cs(sel, '::before').backgroundColor;
      push('sidebar-selected-pill', cs(sel).color, `${pill}||${asideBg}`, 'text');
    }

    const kbd = [...aside.querySelectorAll('button span')].find(
      (s) => s.textContent.trim() === '⌘K',
    );
    if (kbd) push('sidebar-kbd', cs(kbd).color, asideBg, 'text');

    const col = q('[data-column="todo"]');
    if (col) {
      const name = col.querySelector('header span:nth-child(2)');
      if (name) push('column-header', cs(name).color, cs(col).backgroundColor, 'text');
    }

    const card = q('[data-todo-id]');
    if (card) {
      const title = card.querySelector('h3 a');
      if (title) push('card-title', cs(title).color, cs(card).backgroundColor, 'text');
    }

    const trigger = q('button[aria-label="筛选"]');
    const header = q('[data-route="board"] header');
    if (trigger && header) {
      push('filter-trigger', cs(trigger).color, cs(header).backgroundColor, 'text');
    }

    push(
      'focus-ring',
      resolveVar('color', 'var(--focus-ring)'),
      resolveVar('color', 'var(--background)'),
      'ui',
    );

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

      const [pillColor, baseColor] = p.bg.split('||');
      const pill = parseRgb(pillColor);
      const base = parseRgb(baseColor);
      bg = over(pill, base);
    }

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

    check((await page.locator('[data-column]').count()) === 4, 'A1 看板 4 列在场');
    const tracks = await page
      .getByTestId('board-scroller')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    const widths = tracks.split(' ').map((v) => Number.parseFloat(v));
    check(widths.length === 4 && widths.every((w) => w >= 279), `A2 轨道 4 段 ≥280（实测 ${tracks}）`);

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

    const slots = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const btns = [...aside.querySelectorAll('button')];
      return {
        total: btns.length,

        withSlot: btns.filter((b) => b.dataset.slot != null).length,
        bare: btns.filter((b) => b.dataset.slot == null).length,
      };
    });
    check(
      slots.total > 0 && slots.bare === 0,
      `B1 侧栏按钮全数带 data-slot 件槽（${slots.withSlot}/${slots.total}，裸 ${slots.bare}）`,
    );

    const pillOf = (loc) =>
      loc.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
    const sched = page.getByRole('link', { name: '定时' });
    const rest = await pillOf(sched);
    await sched.hover();
    await page.waitForTimeout(300);
    const hovered = await pillOf(sched);
    check(rest !== hovered && hovered !== 'rgba(0, 0, 0, 0)', `C1 行 hover pill 染色（${rest} → ${hovered}）`);
    await page.mouse.move(700, 400);

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

            if (sel.includes('[data-base-ui-portal]')) continue;
            if (sel.includes('\\[')) continue;
            for (const cls of retired) {

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
