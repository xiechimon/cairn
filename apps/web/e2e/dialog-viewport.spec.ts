import { expect, type Locator, test } from '@playwright/test';

test.use({ viewport: { width: 800, height: 500 } });

const CAP = 500 - 48;

async function expectShellCapped(dialog: Locator) {
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.height).toBeLessThanOrEqual(CAP + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(500.5);
}

async function expectBodyOverflows(dialog: Locator) {
  const size = await dialog
    .getByTestId('dialog-body')
    .evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(size.scroll).toBeGreaterThan(size.client);
}

test('provider: 3 model chips overflow the body, submit pinned to the bottom and does not move on scroll', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=01');
  await page.getByRole('button', { name: '添加服务商' }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();

  await expectBodyOverflows(dialog);
  await expectShellCapped(dialog);

  await dialog.getByRole('button', { name: '自定义端点' }).click();
  for (const id of ['relay-a', 'relay-b', 'relay-c']) {
    await dialog.getByRole('button', { name: '添加模型', exact: true }).click();
    await page.getByLabel('搜索模型或输入 ID').fill(id);
    await page.keyboard.press('Enter');
  }
  await expect(dialog.locator('[data-model-chip]')).toHaveCount(3);
  await expectBodyOverflows(dialog);
  await expectShellCapped(dialog);
  const submit = dialog.getByRole('button', { name: '添加模型服务' });
  await expect(submit).toBeInViewport();

  const before = await submit.boundingBox();
  await dialog.getByTestId('dialog-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = await submit.boundingBox();
  expect(after).toEqual(before);
  await expect(submit).toBeInViewport();
});

test('secret: static-form face submit stays in the viewport', async ({ page }) => {
  await page.goto('/app/resources/secrets?scenario=01');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);

  await expect(dialog.getByRole('button', { name: '添加密钥' })).toBeInViewport();
});

test('machine: disclosure expanded (tallest content state) bottom link stays in the viewport', async ({ page }) => {
  await page.goto('/app/resources/machines?scenario=06');
  await page.getByRole('button', { name: '添加执行机' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' }).click();
  const keylink = dialog.getByRole('link', { name: '获取 API key →' });
  await expect(keylink).toBeVisible();
  await expectShellCapped(dialog);
  await expect(keylink).toBeInViewport();
});

test('charter: `取消`/save charter stay in the viewport', async ({ page }) => {
  await page.goto('/app?scenario=102');

  await page.getByRole('button', { name: '编辑' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);
  await expect(dialog.getByRole('button', { name: '取消' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '保存章程' })).toBeInViewport();
});

test('accept(34): `取消`/done stay in the viewport', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=34');
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  await page.getByRole('menuitem', { name: '完成' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);
  await expect(dialog.getByRole('button', { name: '取消' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '完成' })).toBeInViewport();
});

test('schedules `新建定时` editor (900×420): capped to the viewport, its body scrolls inside to reach `取消`/save (#1037)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto('/app?scenario=home-c&pane=tasks&tab=scheduled');
  await page.getByTestId('schedule-new').click();
  const popover = page.getByTestId('schedule-popover');
  await expect(popover).toBeVisible();
  await popover.getByRole('radio', { name: '单次' }).click();
  const box = await popover.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420.5);
  expect(await popover.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await popover.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(popover.getByRole('button', { name: '保存' })).toBeInViewport();
  await expect(popover.getByRole('button', { name: '取消' })).toBeInViewport();
});
