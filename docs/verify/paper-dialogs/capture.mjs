// Dialog evidence (paper-redesign-plan, dialogs PR): light and dark captures
// of every restyled overlay, opened with realistic content on a fixture
// bundle served by `vite preview`.
//   node docs/verify/paper-dialogs/capture.mjs <label> <baseUrl>
// label = before | after; baseUrl = a preview of `vite build --mode fixture`.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });
const png = readFileSync(join(out, '../../../apps/web/public/screenshots/wide.png'));

const SPEC = [
  '登录页加图形验证码，连续三次输错密码后出现',
  '',
  '现在的情况：只有密码框，撞库脚本可以无限重试',
  '我会这样确认完成：第四次提交要求验证码，答错不放行',
  '',
  '![login-flow.png](attachment:att/login-flow.png)',
  '![threat-model.pdf](attachment:att/threat-model.pdf)',
].join('\n');

async function openNewTask(page) {
  await page.goto(`${base}/app?scenario=01`);
  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await dialog.waitFor();
  await dialog.getByTestId('new-task-spec').fill(SPEC);
  return dialog;
}

const shots = {
  async newtask(page) {
    await openNewTask(page);
  },
  async mention(page) {
    const dialog = await openNewTask(page);
    await dialog.getByRole('button', { name: '提及' }).click();
    const picker = page.locator('.mention-picker');
    await picker.waitFor();
    const top = picker.locator('.mention-row--top:not([disabled])').first();
    await top.click();
    const entries = picker.locator('.mention-row--entry');
    await entries.first().click();
    if ((await entries.count()) > 2) await entries.nth(2).click();
    await entries.nth(1).hover();
  },
  async search(page) {
    await page.goto(`${base}/app?scenario=01`);
    await page.locator('[data-todo-id]').first().waitFor();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.keyboard.press('Meta+k');
      const opened = await page
        .getByRole('dialog', { name: '搜索' })
        .waitFor({ timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (opened) break;
    }
    const panel = page.getByRole('dialog', { name: '搜索' });
    await panel.getByRole('textbox').fill('r');
    await panel.locator('[data-row-kind]').first().waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
  },
  async done(page) {
    await page.goto(`${base}/app?scenario=board-drag-matrix`);
    const card = page.locator('[data-todo-id="dm-confirm"]').first();
    await card.waitFor();
    const from = await card.boundingBox();
    const list = await page.locator('[data-column-list="done"]').boundingBox();
    const sx = from.x + from.width / 2;
    const sy = from.y + from.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 8, sy + 6, { steps: 4 });
    await page.mouse.move(list.x + list.width / 2, list.y + list.height - 24, { steps: 12 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.getByRole('dialog', { name: '把任务标记为已完成？' }).waitFor();
  },
  async delete(page) {
    await page.goto(`${base}/app/resources/agents/r3-builder?scenario=agent-delete`);
    await page.locator('.agent-delete').click();
    await page.locator('.delete-confirm').waitFor();
  },
};

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const [name, open] of Object.entries(shots)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await context.route('**/api/attachments/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: png }),
    );
    const page = await context.newPage();
    await open(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `${label}-${theme}-${name}.png`) });
    await context.close();
  }
}
await browser.close();
