#!/usr/bin/env node
// better-colors incremental measurement (acceptance template v3 item 3) — real
// contrast measurement (no estimating) of #1009 A0's new composed faces: the
// floating-window chrome and the FAB family are the only new color-composed
// surfaces this round (zero new color token values — --card/--foreground/
// --text-tertiary/--card-button/--text-on-accent are all existing slots; the
// global palette #988 is sealed with 109 pairs 0 fail in both themes and is
// not re-measured).
//
// Method: read computed color / background-color from real fixture-stack pages
// and compute WCAG 2.1 relative-luminance contrast; run both themes (dark =
// :root default, light = .light on the root element, the #106 inversion
// convention). Floors follow the in-repo canon (spec/22 §1.8 / the #950
// measurement precedent): body/small text ≥ 4.5:1, UI glyphs (icon buttons /
// badge graphics) ≥ 3:1.
//
// Usage (fixture stack must already be running):
//   E2E_PORT=8403 node docs/verify/1009/measure-a0-colors.mjs
// Evidence lands in colors-a0.json in this directory.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '8403';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'colors-a0.json');

const PAIRS = [
  // [face, scenario URL, selector, kind]
  ['window body ink on card', '/app?scenario=111', '.chief-drawer', 'text'],
  ['minimize/header icon ink on card', '/app?scenario=111', '.chief-drawer button[aria-label="最小化"]', 'ui'],
  ['model row ink on card', '/app?scenario=111', '.chief-drawer button[aria-label="总管主模型"]', 'text'],
  ['thread chip title ink on card', '/app?scenario=111', '.chief-drawer button[aria-label="主题"] span', 'text'],
  ['unread badge ink on card-button', '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread', '.fab-badge', 'text'],
  ['FAB glyph ink on card', '/app?scenario=100', '.chief-fab', 'ui'],
  ['FAB kbd-hint chip ink', '/app?scenario=100', '.chief-fab .kbd-hint', 'ui'],
];

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
const parseRgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);

const results = [];
const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const page = await (
    await browser.newContext({ viewport: { width: 1440, height: 732 }, colorScheme: theme })
  ).newPage();
  for (const [name, url, selector, kind] of PAIRS) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
    if (theme === 'light') await page.evaluate(() => document.documentElement.classList.add('light'));
    // FAB and window are mutually exclusive (D4): minimize an open captured-shape window first so the FAB is in place
    if (selector.startsWith('.chief-fab') && (await page.locator('.chief-drawer').isVisible())) {
      await page.locator('.chief-drawer button[aria-label="最小化"]').click();
      await page.locator('.chief-drawer').waitFor({ state: 'hidden' });
    }
    await page.waitForTimeout(150);
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) {
      results.push({ theme, name, selector, error: 'not found' });
      continue;
    }
    const { color, bg } = await el.evaluate((node) => {
      // background = own or nearest opaque ancestor (the window/FAB own background is --card/--card-button)
      let n = node;
      let background = 'rgba(0, 0, 0, 0)';
      while (n != null) {
        const cs = getComputedStyle(n);
        background = cs.backgroundColor;
        const alpha = background.match(/[\d.]+/g)?.[3];
        if (alpha === undefined || Number(alpha) > 0) break;
        n = n.parentElement;
      }
      return { color: getComputedStyle(node).color, bg: background };
    });
    const value = ratio(parseRgb(color), parseRgb(bg));
    const floor = kind === 'text' ? 4.5 : 3;
    results.push({
      theme,
      name,
      selector,
      color,
      bg,
      ratio: Number(value.toFixed(2)),
      floor,
      pass: value >= floor,
    });
  }
  await page.context().close();
}
await browser.close();

const failed = results.filter((r) => r.pass === false || r.error);
writeFileSync(OUT, `${JSON.stringify({ results, failed: failed.length }, null, 2)}\n`);
for (const r of results) {
  console.log(
    `${r.pass === false ? 'FAIL' : r.error ? 'ERR ' : 'PASS'} [${r.theme}] ${r.name} — ${r.ratio ?? r.error} (floor ${r.floor ?? '-'})`,
  );
}
console.log(failed.length === 0 ? `ALL PASS (${results.length} pairs)` : `FAILURES: ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
