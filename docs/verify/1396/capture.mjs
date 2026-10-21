#!/usr/bin/env node
// Fixture evidence for the dark Paper round (#1396): the same six faces in
// both themes from a vite dev or `vite preview` origin that serves the
// fixture scenarios, plus the painted colours of the three paper layers.
//   node docs/verify/1396/capture.mjs <before|after> <baseUrl> [fixture|live]
// before = origin/main, after = this branch. 1440x900 at DPR 1.
// live mode skips the ?scenario= query and expects the verify-pacman stack
// (seeded by live.mjs) at baseUrl.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base, mode = 'fixture'] = process.argv.slice(2);
if (!['before', 'after'].includes(label) || !base) {
  console.error('usage: capture.mjs <before|after> <baseUrl> [fixture|live]');
  process.exit(2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), mode);
mkdirSync(out, { recursive: true });
const q = (s) => (mode === 'fixture' ? `?scenario=${s}` : '');

const TOKENS = [
  'canvas', 'background', 'card', 'popover', 'secondary', 'border', 'input',
  'foreground', 'text-secondary', 'text-tertiary', 'text-dim', 'icon',
  'card-button', 'focus-ring', 'spot-text-on-tint', 'accent-hover', 'spot-soft',
  'running', 'running-text', 'running-bar', 'running-track',
  'dialog-surface', 'dialog-backdrop', 'menu-hover', 'surface-1',
  'project-tile-1', 'project-tile-2', 'project-tile-3', 'project-tile-4', 'project-tile-5', 'project-tile-6',
  'text-on-accent', 'destructive', 'sidebar-hover', 'drop-tint-border',
];

const shots = [
  {
    name: 'board',
    url: `/app${q('board-overflow')}`,
    ready: (page) => page.locator('[data-todo-id]').first().waitFor(),
    probe: true,
  },
  {
    name: 'detail',
    url: mode === 'fixture' ? `/app/todo/7ve0iOkQ-JBpSL98zSiGc${q('26')}` : null,
    ready: (page) => page.waitForSelector('[data-route="todo-detail"]'),
  },
  {
    name: 'account',
    url: `/app/account${q('13')}`,
    ready: (page) => page.getByRole('heading', { name: '帐号' }).first().waitFor(),
  },
  {
    name: 'resources',
    url: `/app/resources/skills${q('06')}`,
    ready: (page) => page.waitForLoadState('networkidle'),
  },
  {
    name: 'newtask',
    url: `/app${q('01')}`,
    ready: async (page) => {
      await page.locator('.sidebar-new-task').click();
      const dialog = page.getByRole('dialog', { name: '新建任务' });
      await dialog.waitFor();
      await dialog.getByTestId('new-task-spec').fill('登录页加图形验证码，连续三次输错密码后出现\n\n现在的情况：只有密码框，撞库脚本可以无限重试');
    },
  },
  {
    name: 'usermenu',
    url: mode === 'fixture' ? `/app/todo/7ve0iOkQ-JBpSL98zSiGc${q('27d')}` : null,
    ready: (page) => page.locator('.user-menu').waitFor(),
  },
  {
    name: 'moremenu',
    url: mode === 'fixture' ? `/app/todo/7ve0iOkQ-JBpSL98zSiGc${q('27')}` : null,
    ready: async (page) => {
      await page.locator('.detail-head-icon--more').click();
      await page.locator('.more-menu').waitFor();
    },
  },
];

const browser = await chromium.launch();
const result = {};
for (const theme of ['dark', 'light']) {
  result[theme] = {};
  for (const shot of shots) {
    if (!shot.url) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    const page = await context.newPage();
    await page.goto(`${base}${shot.url}`);
    await shot.ready(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    if (shot.probe) {
      result[theme] = await page.evaluate((names) => {
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
          theme: document.documentElement.className || '(root)',
          tokens,
          painted: {
            sidebar: bg('.board-sidebar'),
            sheet: bg('.board-sheet'),
            card: bg('.todo-card'),
            body: getComputedStyle(document.body).backgroundColor,
          },
        };
      }, TOKENS);
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-probe.json`), `${JSON.stringify({ label, base, mode, ...result }, null, 2)}\n`);
console.log(JSON.stringify({ dark: result.dark.painted, light: result.light.painted }, null, 2));
