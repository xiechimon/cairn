import { expect, type Page, test } from '@playwright/test';

const DETAIL = '/app/resources/agents/r3-builder?scenario=agent-delete';
const TEAM = '/app/team?scenario=agent-delete';
const CANON_TITLE = '删除 Agent？';
const CANON_BODY = '将「r3-builder」移出团队？该 Agent 进行中的任务将被停止。';

async function openConfirm(page: Page) {
  await page.goto(DETAIL);
  await page.locator('.agent-delete').click();
  const dialog = page.locator('.delete-confirm');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('overview footer has the delete entry, opens a second confirm (canon wording verbatim)', async ({ page }) => {
  await page.goto(DETAIL);

  await expect(page.locator('.agent-overview .agent-danger .agent-delete')).toHaveText(
    '删除 Agent',
  );
  const dialog = await openConfirm(page);
  await expect(dialog).toHaveAttribute('role', 'alertdialog');
  await expect(dialog.locator('.delete-confirm-title')).toHaveText(CANON_TITLE);
  await expect(dialog.locator('.delete-confirm-summary')).toHaveText(CANON_BODY);
  await expect(dialog.locator('.delete-confirm-cancel')).toHaveText('取消');

  await expect(dialog.locator('.delete-confirm-cancel')).toHaveCSS('font-size', '13.5px');
  await expect(dialog.locator('.delete-confirm-cancel')).toHaveCSS('line-height', '20px');
  await expect(dialog.locator('.delete-confirm-delete')).toHaveText('删除');
});

test('entry only on the overview tab: memory / permissions tabs do not render it', async ({ page }) => {
  await page.goto(DETAIL);
  const detail = page.locator('.agent-detail');
  for (const tab of [1, 2]) {
    await detail.locator('.agent-tab').nth(tab).click();
    await expect(page.locator('.agent-delete')).toHaveCount(0);
  }
  await detail.locator('.agent-tab').nth(0).click();
  await expect(page.locator('.agent-delete')).toHaveCount(1);
});

test('family-law close: cancel / X / Esc / backdrop — no delete, no navigation', async ({ page }) => {
  let dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/agent-delete/);

  dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-close').click();
  await expect(dialog).toBeHidden();

  dialog = await openConfirm(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openConfirm(page);

  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();

  await expect(page).toHaveURL(DETAIL);
  await expect(page.locator('.agent-detail')).toBeVisible();
});

test('confirm delete → lands on the team page, deleted card gone, neighbor cards remain', async ({ page }) => {
  const dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-delete').click();
  await expect(page).toHaveURL(/\/app\/team/);

  const cards = page.getByTestId('team-agent-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('r3-qa');
  await expect(cards.filter({ hasText: 'r3-builder' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: '创建 Agent' })).toBeVisible();
});

test('in-session back navigation to the detail route lands the `找不到该 Agent` state, no white screen', async ({ page }) => {
  const dialog = await openConfirm(page);
  await dialog.locator('.delete-confirm-delete').click();
  await expect(page).toHaveURL(/\/app\/team/);

  await page.goBack();
  await expect(page).toHaveURL(/agent-delete/);
  await expect(page.locator('.agent-missing')).toHaveText('找不到该 Agent。它可能已被删除。');
});