// Dumps the innerHTML of every surface this change touches, on fixture-mode
// pages: board cards, the drag overlay, the detail chip popover and the
// new-task dialog (head + project listbox).
// Usage: node fixture-dom-dump.mjs <baseURL> <out.json> <webAppDir>
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [base, out, webDir] = process.argv.slice(2);
const { chromium } = createRequire(join(webDir, 'package.json'))('@playwright/test');

const BOARDS = ['/app?scenario=01', '/app?scenario=board-repos', '/app?scenario=newtask-projects'];
const DETAILS = [
  ['/app/todo/r3-legacy-1?scenario=01', 'click'],
  ['/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19', 'open'],
  ['/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=29', 'open'],
];
const NEW_TASK = [
  ['/app?scenario=01', '.sidebar-new-task'],
  ['/app?scenario=board-repos', '.sidebar-new-task'],
  ['/app?scenario=newtask-projects', '.sidebar-new-task'],
  ['/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24c', '.sidebar-new-task'],
];

const browser = await chromium.launch();
const result = {};
const html = (locator) => locator.evaluate((el) => el.innerHTML);
const newPage = async (path, ready) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 }, colorScheme: 'dark' });
  await page.goto(base + path);
  await page.locator(ready).first().waitFor();
  return page;
};

for (const path of BOARDS) {
  const page = await newPage(path, '[data-testid="board-scroller"] .todo-card');
  const scroller = page.getByTestId('board-scroller');
  await scroller.locator('.todo-card').first().waitFor();
  result[`${path} :: board`] = await html(scroller);

  const card = scroller.locator('.todo-card').first();
  const box = await card.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 8, y + 6, { steps: 4 });
  await page.mouse.move(x - 4, y + 40, { steps: 6 });
  const overlay = page.getByTestId('drag-overlay');
  await overlay.locator('[data-todo-id]').waitFor();
  result[`${path} :: drag-overlay`] = await html(overlay.locator('[data-todo-id]'));
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.close();
}

for (const [path, mode] of DETAILS) {
  const page = await newPage(path, '[data-testid="phase-chip"]');
  if (mode === 'click') await page.getByTestId('phase-chip').click();
  const popover = page.getByRole('dialog', { name: '任务分配' });
  await popover.waitFor();
  await page.waitForTimeout(300);
  result[`${path} :: chip-popover`] = await html(popover);
  await page.close();
}

for (const [path, opener] of NEW_TASK) {
  const page = await newPage(path, opener);
  await page.locator(opener).click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await dialog.waitFor();
  await page.waitForTimeout(300);
  result[`${path} :: new-task-head`] = await html(dialog.getByTestId('new-task-head'));
  await dialog.getByTestId('new-task-project-chip').click();
  const menu = page.getByRole('listbox', { name: '项目' });
  await menu.waitFor();
  await page.waitForTimeout(300);
  result[`${path} :: new-task-projects`] = await html(menu);
  await page.close();
}

await browser.close();
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${Object.keys(result).length} dumps -> ${out}`);
