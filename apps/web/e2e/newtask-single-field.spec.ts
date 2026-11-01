import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence.js';

const BOARD = '/app?scenario=01&view=board';

for (const width of [1440, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`template stays a placeholder and start is primary (${width}px ${theme})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((theme) => {
        localStorage.setItem('cairn-theme', theme);
        localStorage.setItem('cairn.locale', 'en');
      }, theme);
      await page.goto(BOARD);
      await page.getByTestId('board-new-task-bar').click();
      const dialog = page.getByRole('dialog', { name: 'New task', exact: true });
      const body = dialog.getByRole('textbox');
      const save = dialog.locator('.new-task-save');
      const start = dialog.locator('.new-task-start');
      await expect(body).toHaveValue('');
      await expect(body).toHaveAttribute('placeholder', [
        'The outcome I want:',
        'Where things stand now:',
        'What must be kept or avoided:',
        'How I will confirm this is done:',
        'What I expect to receive:',
      ].join('\n'));
      expect(await body.evaluate((el) => el.matches(':placeholder-shown'))).toBe(true);
      await expect(save).toBeDisabled();
      await expect(start).toBeDisabled();
      await expect(dialog).toHaveCSS('opacity', '1');
      await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCSS('opacity', '1');
      await evidenceShot(page, `${width}-${theme}-empty.png`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await page.getByTestId('board-new-task-bar').click();
      await expect(body).toHaveValue('');
      await body.fill(' \n\t ');
      await expect(save).toBeDisabled();
      await expect(start).toBeDisabled();
      await body.fill('Ship the payment callback fix');
      await expect(save).toBeEnabled();
      await expect(start).toBeEnabled();
      expect(await body.evaluate((el) => el.matches(':placeholder-shown'))).toBe(false);
      const primary = await start.evaluate((el) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--primary)';
        el.append(probe);
        const primary = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return primary;
      });
      await expect(start).toHaveCSS('background-color', primary);
      await expect(save).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await evidenceShot(page, `${width}-${theme}-populated.png`);
      await body.fill('');
      expect(await body.evaluate((el) => el.matches(':placeholder-shown'))).toBe(true);
      await expect(start).toBeDisabled();
      await body.fill('Ship the payment callback fix');
      await save.click();
      await expect(dialog).toBeHidden();
      await expect(
        page.locator('.todo-card-title', { hasText: 'Ship the payment callback fix' }),
      ).toBeVisible();
    });
  }
}

async function openDialog(page: Page) {
  await page.goto(BOARD);

  await page.locator('.sidebar-new-task').click();
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('the dialog has no title input and no tag UI', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog.locator('.new-task-input')).toHaveCount(0);
  await expect(dialog.locator('.new-task-tags')).toHaveCount(0);
  await expect(dialog.locator('.new-task-tag-add')).toHaveCount(0);
  await expect(dialog.getByRole('textbox')).toBeVisible();
});

test('save buttons gate on the spec body, not a title', async ({ page }) => {
  const dialog = await openDialog(page);
  const save = dialog.getByRole('button', { name: '保存', exact: true });
  const start = dialog.getByRole('button', { name: '保存并开始' });
  await expect(save).toBeDisabled();
  await expect(start).toBeDisabled();
  await dialog.getByRole('textbox').fill('修支付回调');
  await expect(save).toBeEnabled();
  await expect(start).toBeEnabled();
});

test('fixture save lands a card titled by the first line', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('textbox').fill('给登录页加验证码\n\n现在的情况：无');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const card = page.locator('[data-column="todo"] .todo-card', { hasText: '给登录页加验证码' });
  await expect(card).toBeVisible();

  await expect(card.locator('.todo-card-title')).toHaveText('给登录页加验证码');
});

test('a >50-char first line is truncated with an ellipsis', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.getByRole('textbox').fill('长'.repeat(60));
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const title = page.locator('[data-column="todo"] .todo-card .todo-card-title').last();
  await expect(title).toHaveText(`${'长'.repeat(50)}…`);
});

test('autofocus lands on the spec textarea', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog.getByRole('textbox')).toBeFocused();
});

test('Esc close returns focus to the invoking button (#388 family law; #445 trigger position = sidebar row)', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.sidebar-new-task button')).toBeFocused();
});
