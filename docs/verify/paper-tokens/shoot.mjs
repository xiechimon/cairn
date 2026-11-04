#!/usr/bin/env node
// Light-theme screenshot probe for the Paper color-token PR.
// usage: node docs/verify/paper-tokens/shoot.mjs <fixture|live> <baseURL> <before|after>
// fixture: baseURL = a `vite build --mode fixture && vite preview` origin.
// live:    baseURL = the verify-pacman vite dev origin (fresh library);
//          creates one task through the sidebar New task button, then opens it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [mode, base, label] = process.argv.slice(2);
if (!['fixture', 'live'].includes(mode) || !base || !['before', 'after'].includes(label)) {
  console.error('usage: shoot.mjs <fixture|live> <baseURL> <before|after>');
  process.exit(2);
}
const OUT = join(dirname(fileURLToPath(import.meta.url)), mode);
mkdirSync(OUT, { recursive: true });

const TOKENS = [
  'background', 'foreground', 'card', 'popover', 'primary', 'primary-foreground',
  'secondary', 'muted', 'muted-foreground', 'accent', 'border', 'input', 'ring',
  'text-secondary', 'text-tertiary', 'text-dim', 'card-button', 'focus-ring',
  'spot-soft', 'spot-text-on-tint', 'surface-1', 'canvas', 'running', 'running-text',
  'running-bar', 'running-track', 'accent-hover', 'project-tile-1', 'project-tile-6',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
await ctx.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
const page = await ctx.newPage();
const q = mode === 'fixture' ? '?scenario=01' : '';

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${label}-${name}.png`) });
}

async function surfaces() {
  return page.evaluate((names) => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const tokens = {};
    for (const n of names) {
      probe.style.backgroundColor = `var(--${n})`;
      tokens[n] = getComputedStyle(probe).backgroundColor;
      probe.style.backgroundColor = '';
    }
    probe.remove();
    const bg = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return {
      theme: document.documentElement.className,
      tokens,
      painted: {
        sidebar: bg('.board-sidebar'),
        boardMain: bg('.board-main'),
        boardColumn: bg('.board-column'),
        todoCard: bg('.todo-card'),
        body: getComputedStyle(document.body).backgroundColor,
      },
    };
  }, TOKENS);
}

await page.goto(`${base}/app${q}`);
await page.waitForSelector('.board-sidebar');

if (mode === 'live') {
  await page.click('.sidebar-new-task');
  await page.fill('.new-task-spec', 'Paper token probe task');
  await page.click('.new-task-save');
  await page.locator('.todo-card', { hasText: 'Paper token probe task' }).waitFor();
}
const board = await surfaces();
await shot('board');

await page.locator('body').click({ position: { x: 1, y: 899 } });
let focused = null;
for (let i = 0; i < 6 && !focused; i++) {
  await page.keyboard.press('Tab');
  focused = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || !el.matches(':focus-visible')) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: el.className.toString().slice(0, 80),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      boxShadow: cs.boxShadow,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
  });
}
if (focused) {
  const { x, y, w, h } = focused.rect;
  await page.screenshot({
    path: join(OUT, `${label}-focus-ring.png`),
    clip: { x: Math.max(0, x - 24), y: Math.max(0, y - 24), width: w + 48, height: h + 48 },
  });
}

if (mode === 'fixture') {
  await page.goto(`${base}/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16`);
} else {
  await page.goto(`${base}/app`);
  await page.locator('.todo-card', { hasText: 'Paper token probe task' }).click();
}
await page.waitForSelector('[data-route="todo-detail"]');
await shot('detail');

await page.goto(`${base}/app/resources/skills${mode === 'fixture' ? '?scenario=06' : ''}`);
await page.waitForLoadState('networkidle');
await shot('resources');

writeFileSync(join(OUT, `${label}-probe.json`), `${JSON.stringify({ mode, base, board, focused }, null, 2)}\n`);
console.log(JSON.stringify({ painted: board.painted, focused: focused?.outline }, null, 2));
await browser.close();
