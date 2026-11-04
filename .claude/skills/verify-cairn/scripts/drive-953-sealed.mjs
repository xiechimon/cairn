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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-953-sealed`);
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
  if (c.startsWith('color(')) {
    const m = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (m == null) return null;
    return {
      r: Number(m[1]) * 255,
      g: Number(m[2]) * 255,
      b: Number(m[3]) * 255,
      a: m[4] != null ? Number(m[4]) : 1,
    };
  }
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) return null;
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
};
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const ratio = (c1, c2) => {
  const l1 = lum(c1);
  const l2 = lum(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const scorePairs = (pairs) =>
  pairs.map((p) => {
    let fg = parseRgb(p.fg);
    let bg = parseRgb(p.bg);
    if (fg == null || bg == null) return { ...p, ratio: null, pass: false, note: 'unparsable' };
    if (bg.a < 0.999 || fg.a < 0.999) {

      const base = parseRgb(p.base ?? '') ?? { r: 255, g: 255, b: 255, a: 1 };
      if (bg.a < 0.999) bg = over(bg, base);
      if (fg.a < 0.999) fg = over(fg, bg);
    }
    const r = ratio(fg, bg);
    const floor = p.kind === 'text' ? 4.5 : p.kind === 'ui' ? 3.0 : null;
    return {
      ...p,
      ratio: Math.round(r * 100) / 100,
      floor,
      pass: floor == null ? true : r >= floor,
    };
  });

const RETIRED_SELECTORS = [
  '.dlg-title',
  '.dlg-close',
  '.dlg-head',
  '.dlg-body',
  '.dlg-foot',
  '.dlg-backdrop',
  '.dlg-form',
  '.dlg-agent-create',
  '.dlg-shell',
  '.dlg-viewport',
  '.agent-name',
  '.agent-task-row',
  '.agent-tasks',
  '.agent-memory',
  '.agent-perm',
  '.agent-role',
  '.agent-thinking',
  '.agent-secret-add',
  '.profile-card',
  '.profile-row',
  '.profile-head',
  '.profile-avatar',
  '.profile-label',
  '.profile-hint',
  '.profile-value',
  '.ui-select-menu',
  '.ui-select-row',
  '.ui-select-shell',
  '.ui-checkbox-tile',
  '.ui-checkbox-indicator',
  '.anchored-pop-shell',
  '.chip--',
  '.sidebar-row--selected',
  '.sidebar-subrow--selected',
  '.sidebar-team-row--active',
];
const auditStylesheets = (page) =>
  page.evaluate((retired) => {
    const hits = [];
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules != null) {
          walk(rule.cssRules);
          continue;
        }
        const sel = rule.selectorText;
        if (sel == null || sel.includes('\\')) continue;
        for (const name of retired) {
          if (sel.includes(name)) hits.push(`${sel} (${name})`);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      walk(rules);
    }
    return hits;
  }, RETIRED_SELECTORS);

const toggleSlots = (page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      track: cs.getPropertyValue('--toggle-track').trim(),
      knob: cs.getPropertyValue('--toggle-knob').trim(),
    };
  });

const selectedRowTruth = (page) =>
  page.evaluate(() => {
    const resolveVar = (decl, value) => {
      const probe = document.createElement('div');
      probe.style.setProperty(decl, value);
      document.body.append(probe);
      const out = getComputedStyle(probe).getPropertyValue(decl).trim();
      probe.remove();
      return out;
    };
    const row = document.querySelector('aside [aria-current="page"], [role="complementary"] [aria-current="page"]');
    if (row == null) return { found: false };
    const cs = getComputedStyle(row);
    const before = getComputedStyle(row, '::before');

    let surface = '';
    for (let el = row.parentElement; el != null; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg != null && bg !== 'transparent' && !bg.endsWith('/ 0)') && !bg.includes(', 0)')) {
        const m = bg.match(/[\d.]+/g);
        if (m != null && m.length >= 3 && (m.length < 4 || Number(m[3]) > 0)) {
          surface = bg;
          break;
        }
      }
    }
    return {
      found: true,
      className: row.className,
      fg: cs.color,
      pillBg: before.backgroundColor,
      surfaceBg: surface,
      tokens: {
        mutedForeground: resolveVar('color', 'var(--muted-foreground)'),
        foreground: resolveVar('color', 'var(--foreground)'),
        sidebarActive: resolveVar('color', 'var(--sidebar-active)'),
        textSecondary: resolveVar('color', 'var(--text-secondary)'),
      },
    };
  });

const tokenPairs = (page) =>
  page.evaluate(() => {
    const resolveVar = (decl, value) => {
      const probe = document.createElement('div');
      probe.style.setProperty(decl, value);
      document.body.append(probe);
      const out = getComputedStyle(probe).getPropertyValue(decl).trim();
      probe.remove();
      return out;
    };
    const tokenPair = (face, fgVar, bgVar, kind, baseVar) => ({
      face,
      fg: resolveVar('color', fgVar),
      bg: resolveVar('color', bgVar),
      base: baseVar == null ? undefined : resolveVar('color', baseVar),
      kind,
    });

    return [
      tokenPair('detail-value', 'var(--text-primary)', 'var(--surface-secondary)', 'text'),
      tokenPair('dialog-body', 'var(--foreground)', 'var(--dialog-bg)', 'text'),
      tokenPair('chip-done', 'var(--chip-done-fg)', 'var(--chip-done-bg)', 'text'),
      tokenPair('brand-button', 'var(--text-on-accent)', 'var(--card-button)', 'text'),
      tokenPair('danger-text', 'var(--danger)', 'var(--background)', 'text'),
      tokenPair('switch-track-flip', 'var(--input)', 'var(--primary)', 'ui'),
      tokenPair('stop-face', 'var(--stop)', 'var(--background)', 'ui'),
    ];
  });

const browser = await chromium.launch();
const contrast = {};
const selectedRow = {};
const TASK_TITLE = `封版抽样 ${Date.now() % 100000}`;

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    colorScheme: theme,
  });
  await context.addInitScript(([t]) => localStorage.setItem('cairn-theme', t), [theme]);
  const page = await context.newPage();

  await page.goto(`${WEB}/app`);
  await page
    .locator('[data-testid="board-scroller"]')
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  const hits = await auditStylesheets(page);
  check(
    hits.length === 0,
    `A1-${theme} 退役选择器零规则（含 §5.0 别名残留三面；命中 ${hits.length}${hits.length > 0 ? `：${hits.slice(0, 5).join('; ')}` : ''}）`,
  );
  const slots = await toggleSlots(page);
  check(
    slots.track === '' && slots.knob === '',
    `A2-${theme} --toggle-track/--toggle-knob 两槽保持已删（track='${slots.track}' knob='${slots.knob}'）`,
  );

  const row = await selectedRowTruth(page);
  selectedRow[theme] = row;
  check(row.found === true, `B1-${theme} 选中行在场（aria-current="page" 一级载体）`);
  if (row.found) {
    check(
      row.fg === row.tokens.mutedForeground,
      `B2-${theme} 选中行前景 == --muted-foreground（渲染真值 muted：fg='${row.fg}' token='${row.tokens.mutedForeground}'）`,
    );
    check(
      row.fg !== row.tokens.foreground,
      `B3-${theme} 选中行前景 != --foreground（死槽 text-foreground 从未生效：foreground='${row.tokens.foreground}'）`,
    );
    check(
      row.pillBg === row.tokens.sidebarActive,
      `B4-${theme} 选中行 pill == --sidebar-active（pill='${row.pillBg}' token='${row.tokens.sidebarActive}'）`,
    );

    const fgC = parseRgb(row.fg);
    const pillC = parseRgb(row.pillBg);
    const surfC = parseRgb(row.surfaceBg);
    if (fgC == null || pillC == null || surfC == null) {
      check(false, `B5-${theme} 选中行对比可解析（fg/pill/surface='${row.surfaceBg}'）`);
    } else {
      const composited = pillC.a < 0.999 ? over(pillC, surfC) : pillC;
      const r = ratio(fgC, composited);
      row.contrastOnPill = Math.round(r * 100) / 100;
      check(
        r >= 4.5,
        `B5-${theme} 选中行墨/pill 合成底对比 ${row.contrastOnPill}:1 ≥ 4.5（surface='${row.surfaceBg}'）`,
      );
    }
  }

  const pairs = await tokenPairs(page);
  const rows = scorePairs(pairs);
  const bad = rows.filter((r) => !r.pass);
  check(
    bad.length === 0,
    `D-${theme} 跨域对比度 ${rows.length} 对全过（未过 ${bad.length}：${bad
      .map((r) => `${r.face} ${r.ratio}`)
      .join('; ')}）`,
  );
  contrast[theme] = rows;

  if (theme === 'dark') {

    await page.locator('.sidebar-new-task').click();
    const dialog = page.getByRole('dialog', { name: '新建任务' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      .catch(() => {});
    await shot(page, `c2-newtask-dialog-${theme}.png`);
    await dialog.getByRole('textbox').fill(TASK_TITLE);
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    const card = page.locator(`[data-column-list="todo"] .todo-card`, { hasText: TASK_TITLE });
    await card.waitFor({ state: 'visible', timeout: 15_000 });
  }
  await page.waitForTimeout(400);
  await shot(page, `c1-board-${theme}.png`);

  const card = page.locator(`[data-column-list="todo"] .todo-card`, { hasText: TASK_TITLE });
  if (theme === 'light') {
    await card.waitFor({ state: 'visible', timeout: 15_000 });
    const dialog2 = page.getByRole('dialog', { name: '新建任务' });
    await page.locator('.sidebar-new-task').click();
    await dialog2.waitFor({ timeout: 10_000 });
    await dialog2
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      .catch(() => {});
    await shot(page, `c2-newtask-dialog-${theme}.png`);
    await dialog2.getByRole('button', { name: '关闭' }).click();
    await dialog2.waitFor({ state: 'hidden', timeout: 10_000 });
  }
  await card.click();
  await page.waitForTimeout(800);
  await shot(page, `c3-detail-${theme}.png`);

  await page.goto(`${WEB}/app/resources`);
  await page.waitForTimeout(800);
  await shot(page, `c4-resources-${theme}.png`);

  await context.close();
}

const result = {
  ticket: 953,
  probe: 'drive-953-sealed',
  at: new Date().toISOString(),
  failures,
  checks,
  artifacts,
  selectedRow,
  contrast,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${checks.length - failures}/${checks.length} PASS · 证据目录 ${EVIDENCE}`);

await browser.close();
process.exit(failures > 0 ? 1 : 0);
