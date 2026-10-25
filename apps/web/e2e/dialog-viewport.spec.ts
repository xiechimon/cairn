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

test('provider: 3 model rows overflow the body, submit pinned to the bottom and does not move on scroll', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=01');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await expectBodyOverflows(dialog);
  await expectShellCapped(dialog);

  await dialog.getByRole('button', { name: '自定义端点' }).click();
  const addModel = dialog.getByRole('button', { name: '添加模型', exact: true });
  await addModel.click();
  await addModel.click();
  await addModel.click();
  await expect(dialog.locator('[aria-label="模型 ID"]')).toHaveCount(3);
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
  await page.getByRole('button', { name: '添加机器' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' }).click();
  const keylink = dialog.getByRole('link', { name: '获取 API key →' });
  await expect(keylink).toBeVisible();
  await expectShellCapped(dialog);
  await expect(keylink).toBeInViewport();
});

test('create-agent: submit stays in the viewport', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeInViewport();
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

test('chief-agent list state (buttonless read face) panel stays within the viewport entirely', async ({ page }) => {
  await page.goto('/app?scenario=101');

  await page.getByRole('button', { name: '未设置' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);
  await expect(dialog.getByRole('listbox')).toBeInViewport();
});

test('branch sync tab: viewport shorter than content, sync button pinned to bottom, body overflows; git tab normal', async ({ page }) => {

  await page.setViewportSize({ width: 800, height: 360 });
  await page.goto('/app?scenario=01');
  await page.locator('.todo-card-branch').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectBodyOverflows(dialog);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.height).toBeLessThanOrEqual(360 - 48 + 0.5);
  await expect(dialog.getByRole('button', { name: '同步', exact: true })).toBeInViewport();

  await dialog.getByRole('tab', { name: 'Git' }).click();
  await expect(dialog.getByRole('button', { name: '同步', exact: true })).toHaveCount(0);
  await expect(dialog.getByText('构建分支')).toBeInViewport();
});

test('accept(34): `取消`/done stay in the viewport', async ({ page }) => {
  await page.goto('/app?scenario=34');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expectShellCapped(dialog);
  await expect(dialog.getByRole('button', { name: '取消' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '完成' })).toBeInViewport();
});

test('schedules `新建定时` (900×420): capped, body scrolls inside, `取消`/save/X always in the viewport (#1037)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await page.goto('/app/schedules?scenario=r3-92b');
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await expect(dialog).toBeVisible();
  await expectBodyOverflows(dialog);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.height).toBeLessThanOrEqual(420 - 48 + 0.5);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(420.5);
  const save = dialog.getByRole('button', { name: '保存' });
  await expect(save).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '关闭' })).toBeInViewport();

  const before = await save.boundingBox();
  await dialog.getByTestId('dialog-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const after = await save.boundingBox();
  expect(after).toEqual(before);
  await expect(save).toBeInViewport();
});
