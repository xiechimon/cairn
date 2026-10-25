#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

let stack;
try {
  stack = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
} catch {
  console.error(`无栈:${join(RUN_DIR, 'ports.json')} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const WEB = `http://127.0.0.1:${stack.webPort}`;

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-1010-select`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const contrast = {};
const payloads = {};
let failures = 0;
const check = (ok, label, detail) => {
  checks.push({ ok, label, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail != null ? `  — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const parseColor = (str) => {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts;
  const a = parts.length >= 4 ? parts[3] : 1;
  return { r, g, b, a };
};
const lum = ({ r, g, b }) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (fg, bg) => {
  const l1 = lum(fg);
  const l2 = lum(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, base) => {
  const a = fg.a ?? 1;
  return {
    r: Math.round(fg.r * a + base.r * (1 - a)),
    g: Math.round(fg.g * a + base.g * (1 - a)),
    b: Math.round(fg.b * a + base.b * (1 - a)),
    a: 1,
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
const shot = async (name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  console.log(`shot  ${name}`);
};

const effectiveBg = (el) => {
  let node = el;
  while (node && node !== document.documentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      const a = parts.length >= 4 ? parts[3] : 1;
      if (a > 0.999) return bg;
    }
    node = node.parentElement;
  }
  return getComputedStyle(document.documentElement).backgroundColor || 'rgb(255,255,255)';
};

const waitListboxesGone = async () => {
  await page
    .waitForFunction(() => document.querySelectorAll('[role="listbox"]').length === 0, null, {
      timeout: 5000,
    })
    .catch(() => {});
};

const runContrast = async (mode) => {
  await page.locator('button[aria-label="时"]').click();
  await page.getByRole('listbox').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);

  const itemPair = await page.evaluate(() => {
    const el = document.querySelector('[role="option"]');
    if (!el) return { error: 'no option' };
    const cs = getComputedStyle(el);
    let node = el;
    let bgRaw = 'rgb(255,255,255)';
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
        if ((parts.length >= 4 ? parts[3] : 1) > 0.999) {
          bgRaw = bg;
          break;
        }
      }
      node = node.parentElement;
    }
    return { fgRaw: cs.color, bgRaw };
  });

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(80);
  const focusPair = await page.evaluate(() => {
    const opt =
      document.querySelector('[role="option"][data-highlighted]') ??
      document.querySelector('[role="option"][data-focus-visible]') ??
      document.querySelector('[role="option"]');
    if (!opt) return { error: 'no option' };
    const cs = getComputedStyle(opt);

    let bgRaw = cs.backgroundColor;
    const m = bgRaw.match(/rgba?\(([^)]+)\)/);
    const parts = m ? m[1].split(/[,/\s]+/).filter(Boolean).map(Number) : [];
    const a = parts.length >= 4 ? parts[3] : 1;
    let isRowBg = a > 0.999 || (m && a > 0.01);
    if (!isRowBg) {
      let node = opt.parentElement;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const mm = bg.match(/rgba?\(([^)]+)\)/);
        if (mm) {
          const pp = mm[1].split(/[,/\s]+/).filter(Boolean).map(Number);
          if ((pp.length >= 4 ? pp[3] : 1) > 0.999) {
            bgRaw = bg;
            break;
          }
        }
        node = node.parentElement;
      }
    }
    return {
      fgRaw: cs.color,
      bgRaw,
      isHighlighted:
        opt.hasAttribute('data-highlighted') || opt.hasAttribute('data-focus-visible'),
    };
  });

  const trigPair = await page.evaluate(() => {
    const el =
      document.querySelector('button[aria-label="时"] [data-slot="select-value"]') ??
      document.querySelector('button[aria-label="时"]');
    if (!el) return { error: 'no trigger value' };
    const cs = getComputedStyle(el);
    let node = el;
    let bgRaw = 'rgb(255,255,255)';
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
        if ((parts.length >= 4 ? parts[3] : 1) > 0.999) {
          bgRaw = bg;
          break;
        }
      }
      node = node.parentElement;
    }
    return { fgRaw: cs.color, bgRaw };
  });

  await page.keyboard.press('Escape');
  await waitListboxesGone();

  const rows = [];
  for (const [name, pair] of [
    ['item-text-on-popup', itemPair],
    ['focus-item-text-on-accent', focusPair],
    ['trigger-text-on-bg', trigPair],
  ]) {
    if (pair?.error) {
      rows.push({ pair: name, mode, error: pair.error });
      continue;
    }
    const fg = parseColor(pair.fgRaw);
    const bg = { ...(parseColor(pair.bgRaw) ?? { r: 255, g: 255, b: 255 }), a: 1 };
    const fgEff = fg.a < 0.999 ? composite(fg, bg) : fg;
    const r = ratio(fgEff, bg);
    rows.push({
      pair: name,
      mode,
      fg: pair.fgRaw,
      bg: pair.bgRaw,
      ratio: Number(r.toFixed(2)),
      pass4_5: r >= 4.5,
      isHighlighted: pair.isHighlighted ?? null,
    });
  }
  contrast[mode] = rows;
  return rows;
};

try {

  await page.goto(`${WEB}/app/schedules`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await dialog.waitFor({ state: 'visible', timeout: 8000 });
  await page.getByRole('tab', { name: '单次' }).click();
  await shot('01-sched-dialog-once.png');

  await page.locator('button[aria-label="时"]').click();
  const listbox = page.getByRole('listbox').first();
  await listbox.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
  const struct = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const popup = document.querySelector('[data-slot="select-content"]');
    const trig = document.querySelector('button[aria-label="时"]');
    return {
      listboxTag: lb?.tagName ?? null,
      listboxAriaLabel: lb?.getAttribute('aria-label'),
      listboxOptionCount: lb ? lb.querySelectorAll('[role="option"]').length : 0,
      popupRole: popup?.getAttribute('role') ?? null,
      popupAriaLabel: popup?.getAttribute('aria-label') ?? null,
      popupDataSlot: popup?.getAttribute('data-slot') ?? null,
      trigTag: trig?.tagName ?? null,
      trigAriaHaspopup: trig?.getAttribute('aria-haspopup') ?? null,
      trigAriaExpanded: trig?.getAttribute('aria-expanded') ?? null,
      trigAriaControls: trig?.getAttribute('aria-controls') ?? null,
      trigAriaLabel: trig?.getAttribute('aria-label') ?? null,
      listboxIsInsidePopup: popup && lb ? popup.contains(lb) : null,
    };
  });
  payloads.structure = struct;
  check(struct.popupDataSlot === 'select-content', 'B1 弹层外层 = data-slot=select-content', struct.popupDataSlot);
  check(struct.popupRole === 'presentation', 'B2 外层 Popup role=presentation（registry/Base UI 形）', struct.popupRole);
  check(struct.popupAriaLabel === '时', 'B3 SelectContent 的 aria-label 落在 Popup（presentation）', struct.popupAriaLabel);
  check(struct.listboxTag === 'DIV', 'B4 role=listbox 落在内层 Select.List（div）', struct.listboxTag);
  check(struct.listboxAriaLabel === null, 'B5 内层 listbox 的 aria-label 恒 null（m5 钩子迁 [role=listbox] 的实物因）', String(struct.listboxAriaLabel));
  check(struct.listboxOptionCount === 24, 'B6 时 listbox = 24 档（00–23）', struct.listboxOptionCount);
  check(struct.listboxIsInsidePopup === true, 'B7 listbox 嵌在 Popup 内', struct.listboxIsInsidePopup);
  check(struct.trigTag === 'BUTTON', 'B8 触发钮 = button', struct.trigTag);
  check(struct.trigAriaLabel === '时', 'B9 触发钮 aria-label=时（triggerLabel 承载可及名）', struct.trigAriaLabel);
  check(struct.trigAriaHaspopup === 'listbox', 'B10 触发钮 aria-haspopup=listbox', struct.trigAriaHaspopup);
  check(struct.trigAriaExpanded === 'true', 'B11 开面态 aria-expanded=true', struct.trigAriaExpanded);
  check(
    typeof struct.trigAriaControls === 'string' && struct.trigAriaControls.length > 0,
    'B12 触发钮 aria-controls→listbox',
    struct.trigAriaControls,
  );
  await shot('02-time-listbox-open-light.png');

  await page.getByRole('option', { name: '08', exact: true }).click();
  await page.waitForTimeout(120);
  const timeEcho = (await page.locator('button[aria-label="时"]').textContent()) ?? '';
  check(timeEcho.includes('08'), 'A1 时 选 08 回显触发钮', timeEcho.trim());

  await waitListboxesGone();
  const minTrigger = page.locator('button[aria-label="分"]');
  await minTrigger.click();
  await page.waitForTimeout(200);
  const minInfo = await page.evaluate(() => {
    const trig = document.querySelector('button[aria-label="分"]');
    const id = trig?.getAttribute('aria-controls');
    const lb = id ? document.getElementById(id) : null;
    return {
      id,
      count: lb ? lb.querySelectorAll('[role="option"]').length : -1,
      allListboxes: document.querySelectorAll('[role="listbox"]').length,
    };
  });
  payloads.minuteListbox = minInfo;
  check(minInfo.count === 4, 'A2 分 listbox = 4 档（00/15/30/45，aria-controls 定域）', JSON.stringify(minInfo));
  await shot('03-minute-listbox-open-light.png');

  await page.getByRole('option', { name: '30', exact: true }).click();
  await page.waitForTimeout(120);
  const minEcho = (await page.locator('button[aria-label="分"]').textContent()) ?? '';
  check(minEcho.includes('30'), 'A3 分 选 30 回显触发钮', minEcho.trim());
  await waitListboxesGone();

  await runContrast('light');

  await page.evaluate(() => localStorage.setItem('cairn-theme', 'dark'));
  await page.goto(`${WEB}/app/schedules`, { waitUntil: 'networkidle' });
  const isDark = await page.evaluate(
    () =>
      document.documentElement.dataset.theme === 'dark' &&
      !document.documentElement.classList.contains('light'),
  );
  check(isDark === true, 'D1 暗模已生效（data-theme=dark，无 light 类）', String(isDark));
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog2 = page.getByRole('dialog', { name: '新建定时' });
  await dialog2.waitFor({ state: 'visible', timeout: 8000 });
  await page.getByRole('tab', { name: '单次' }).click();
  await page.locator('button[aria-label="时"]').click();
  await page.getByRole('listbox').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
  await shot('04-time-listbox-open-dark.png');
  await page.keyboard.press('Escape');
  await waitListboxesGone();
  await runContrast('dark');

  for (const mode of ['light', 'dark']) {
    for (const row of contrast[mode] ?? []) {
      if (row.error) {
        check(false, `C ${mode}/${row.pair} 量取失败`, row.error);
        continue;
      }
      check(
        row.pass4_5 === true,
        `C ${mode}/${row.pair} 对比度 ≥4.5`,
        `${row.ratio}:1 (fg ${row.fg} / bg ${row.bg})`,
      );
    }
  }
} catch (err) {
  console.error('probe crashed:', err);
  failures += 1;
  checks.push({ ok: false, label: 'probe-crashed', detail: String(err?.message ?? err) });
} finally {
  const result = {
    probe: 'drive-1010-select',
    ticket: '#1010 select.tsx 手写件退役 → registry compound select',
    stack: { web: WEB },
    checks,
    contrast,
    payloads,
    allOk: failures === 0,
    failures,
  };
  writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(`\nevidence: ${EVIDENCE}`);
  console.log(`allOk=${failures === 0}`);
  console.log(`drive 1010-select:${failures === 0 ? 'PASS' : 'FAIL'}`);
  process.exit(failures === 0 ? 0 : 1);
}
