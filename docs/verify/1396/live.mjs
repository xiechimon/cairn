#!/usr/bin/env node
// Live evidence for the dark Paper round (#1396) on the verify-pacman stack
// (fresh library, vite dev at baseUrl). Real clicks only: a task is created
// through the sidebar New task button, the detail opens from its card, the
// user menu opens from the user row, and the theme is flipped from the 外观
// control inside that menu. Both themes; the dark run also records the flip.
//   node docs/verify/1396/live.mjs <baseUrl>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [base] = process.argv.slice(2);
if (!base) {
  console.error('usage: live.mjs <baseUrl>');
  process.exit(2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'live');
mkdirSync(out, { recursive: true });
const TITLE = '暗色纸面验收任务';

const painted = (page) =>
  page.evaluate(() => {
    const bg = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return {
      theme: document.documentElement.dataset.theme,
      sidebar: bg('.board-sidebar'),
      sheet: bg('.board-sheet'),
      card: bg('.todo-card'),
      badge: bg('.sidebar-new-task'),
    };
  });

const browser = await chromium.launch();
const result = {};
for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
  const page = await context.newPage();
  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(out, `${theme}-${name}.png`) });
  };

  await page.goto(`${base}/app`);
  await page.waitForSelector('.board-sidebar');
  if (!(await page.locator('.todo-card', { hasText: TITLE }).count())) {
    await page.locator('.sidebar-new-task').click();
    const dialog = page.getByRole('dialog', { name: '新建任务' });
    await dialog.waitFor();
    await dialog.getByTestId('new-task-spec').fill(`${TITLE}\n\n看板、详情、设置、弹窗与菜单在暗色 Paper 阶梯上各走一遍。`);
    await shot('newtask');
    await page.locator('.new-task-save').click();
    await page.locator('.todo-card', { hasText: TITLE }).waitFor();
  }
  result[theme] = { board: await painted(page) };
  await shot('board');

  await page.locator('.sidebar-user').click();
  await page.locator('.user-menu').waitFor();
  await shot('usermenu');

  if (theme === 'dark') {
    await page.locator('.user-menu-seg button', { hasText: '浅色' }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('light'));
    result.flip = { toLight: await painted(page) };
    await shot('flip-to-light');
    await page.locator('.user-menu-seg button', { hasText: '深色' }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('light'));
    result.flip.backToDark = await painted(page);
    await shot('flip-back-to-dark');
  }
  await page.keyboard.press('Escape');

  await page.locator('.todo-card', { hasText: TITLE }).click();
  await page.waitForSelector('[data-route="todo-detail"]');
  await shot('detail');

  await page.goto(`${base}/app/account`);
  await page.getByRole('heading', { name: '帐号' }).first().waitFor();
  await shot('account');

  await context.close();
}
await browser.close();
writeFileSync(join(out, 'live-probe.json'), `${JSON.stringify({ base, ...result }, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
