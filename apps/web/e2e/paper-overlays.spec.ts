import { expect, type Locator, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence.js';

const SECRETS = '/app/resources/secrets?scenario=01';
const SKILLS = '/app/resources/skills?scenario=01';
const PROVIDERS = '/app/resources/providers?scenario=01';
const MACHINES = '/app/resources/machines?scenario=06';
const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

async function resolveColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.backgroundColor = v;
    document.body.append(el);
    const out = getComputedStyle(el).backgroundColor;
    el.remove();
    return out;
  }, value);
}

async function settle(locator: Locator) {
  await locator.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
}

async function openFromTopbar(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name });
  await expect(dialog).toBeVisible();
  await settle(dialog);
  return dialog;
}

async function openDeleteConfirm(page: Page) {
  await page.goto(DETAIL);
  await page.getByRole('button', { name: '更多' }).click();
  await page.locator('.more-menu-item[data-action="delete"]').click();
  const dialog = page.locator('.delete-confirm');
  await expect(dialog).toBeVisible();
  await settle(dialog);
  return dialog;
}

for (const theme of ['light', 'dark'] as const) {
  test(`backdrop is the light dim, no blur, on dialogs and confirms (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    const want = await (async () => {
      await page.goto(SECRETS);
      return resolveColor(page, 'var(--dialog-backdrop)');
    })();
    if (theme === 'light') expect(want).toBe('rgba(43, 38, 32, 0.14)');

    await openFromTopbar(page, SECRETS, '添加密钥');
    const overlay = page.locator('[data-slot="dialog-overlay"]');
    await settle(overlay);
    await expect(overlay).toHaveCSS('background-color', want);
    await expect(overlay).toHaveCSS('backdrop-filter', 'none');
    await page.keyboard.press('Escape');

    await openDeleteConfirm(page);
    const alertOverlay = page.locator('[data-slot="alert-dialog-overlay"]');
    await settle(alertOverlay);
    await expect(alertOverlay).toHaveCSS('background-color', want);
    await expect(alertOverlay).toHaveCSS('backdrop-filter', 'none');
  });
}

test('dialog widths are S 400 / M 480 / L 640', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  const width = async (dialog: Locator) => (await dialog.boundingBox())?.width;

  const secret = await openFromTopbar(page, SECRETS, '添加密钥');
  expect(await width(secret)).toBe(400);
  await evidenceShot(page, 'secret-dialog-s.png');

  await page.goto(SKILLS);
  await page.getByRole('button', { name: '新建技能' }).first().click();
  const skill = page.getByRole('dialog', { name: '新建技能' });
  await expect(skill).toBeVisible();
  await settle(skill);
  expect(await width(skill)).toBe(480);

  const provider = await openFromTopbar(page, PROVIDERS, '添加模型服务');
  expect(await width(provider)).toBe(640);

  const confirm = await openDeleteConfirm(page);
  expect(await width(confirm)).toBe(400);
  await evidenceShot(page, 'delete-confirm-s.png');
});

test('dialog face: sheet surface, 16px corners, 16px serif title, 28px close', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  const dialog = await openFromTopbar(page, SECRETS, '添加密钥');
  await expect(dialog).toHaveCSS('background-color', await resolveColor(page, '#f7f1e1'));
  await expect(dialog).toHaveCSS('border-top-left-radius', '16px');
  const title = dialog.getByTestId('dialog-head').getByText('添加密钥');
  await expect(title).toHaveCSS('font-size', '16px');
  const close = dialog.getByRole('button', { name: '关闭' });
  const box = await close.boundingBox();
  expect(box?.width).toBe(28);
  expect(box?.height).toBe(28);
});

test('split footer: hint left, actions right, no band fill', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(MACHINES);
  await page.getByRole('button', { name: '添加机器' }).first().click();
  const dialog = page.getByRole('dialog', { name: '添加机器' });
  await expect(dialog).toBeVisible();
  await settle(dialog);
  expect((await dialog.boundingBox())?.width).toBe(640);

  const foot = dialog.getByTestId('dialog-foot');
  await expect(foot).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(foot).toHaveCSS('border-top-width', '0px');
  const hint = foot.getByRole('link', { name: '浏览器授权注册 →' });
  const done = foot.getByRole('button', { name: '完成' });
  await expect(hint).toHaveCSS('font-size', '12px');
  const dialogBox = await dialog.boundingBox();
  const footBox = await foot.boundingBox();
  const hintBox = await hint.boundingBox();
  const doneBox = await done.boundingBox();
  if (dialogBox == null || footBox == null || hintBox == null || doneBox == null) {
    throw new Error('footer geometry missing');
  }
  expect(hintBox.x - dialogBox.x).toBe(20);
  expect(dialogBox.x + dialogBox.width - (doneBox.x + doneBox.width)).toBe(20);
  expect(doneBox.height).toBe(32);
  await expect(done).toHaveAttribute('data-variant', 'default');
  await evidenceShot(page, 'machine-dialog-split-footer.png');
});

test('footer stays on screen on a short viewport; only the body scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.goto(MACHINES);
  await page.getByRole('button', { name: '添加机器' }).first().click();
  const dialog = page.getByRole('dialog', { name: '添加机器' });
  await expect(dialog).toBeVisible();
  await settle(dialog);
  await dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' }).click();
  const box = await dialog.boundingBox();
  const done = await dialog.getByRole('button', { name: '完成' }).boundingBox();
  expect(box).not.toBeNull();
  expect(done).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(500 - 32);
  expect((done?.y ?? 0) + (done?.height ?? 0)).toBeLessThanOrEqual(
    (box?.y ?? 0) + (box?.height ?? 0),
  );
  const body = dialog.getByTestId('dialog-body');
  const overflow = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(overflow).toBe(true);
});

test('Paper menu: 32px rows, 13.5px text, 15px icons, 18px panel corners, 4px padding', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(DETAIL);
  await page.getByRole('button', { name: '更多' }).click();
  const menu = page.locator('.more-menu');
  await expect(menu).toBeVisible();
  await settle(menu);
  await expect(menu).toHaveCSS('border-top-left-radius', '18px');
  await expect(menu).toHaveCSS('padding-top', '4px');
  await expect(menu).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  const rows = menu.getByRole('menuitem');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    expect((await row.boundingBox())?.height).toBe(32);
    await expect(row).toHaveCSS('font-size', '13.5px');
    const icon = await row.locator('svg').first().boundingBox();
    expect(icon?.width).toBe(15);
  }
  const copy = menu.locator('.more-menu-item', { hasText: '复制链接' });
  await copy.hover();
  await expect(copy).toHaveCSS('background-color', await resolveColor(page, '#f6f2ec'));
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await evidenceShot(page, 'more-menu.png');
});

test('user menu rides the same Paper menu face', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto('/app?scenario=01');
  await page.getByRole('complementary').getByRole('button', { name: 'Xmon Dai' }).click();
  const menu = page.locator('.user-menu');
  await expect(menu).toBeVisible();
  await settle(menu.locator('..'));
  await expect(menu).toHaveCSS('border-top-left-radius', '18px');
  await expect(menu).toHaveCSS('padding-top', '4px');
  for (const label of ['帐号', 'API 密钥', 'MCP']) {
    const row = menu.locator('a.user-menu-row', { hasText: label });
    expect((await row.boundingBox())?.height).toBe(32);
    await expect(row).toHaveCSS('font-size', '13.5px');
  }
  await evidenceShot(page, 'user-menu.png');
});

test('provider picker: grouped rows, search hides empty groups', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  const dialog = await openFromTopbar(page, PROVIDERS, '添加模型服务');
  await expect(dialog.locator('fieldset')).toHaveCount(6);
  for (const name of ['订阅登录', '模型厂商', '云平台', '推理平台', '网关与聚合', '其他']) {
    await expect(dialog.getByRole('group', { name })).toBeVisible();
  }
  const row = dialog.locator('[data-preset-id="anthropic"]');
  expect((await row.boundingBox())?.height).toBe(40);
  await expect(dialog.getByRole('group', { name: '订阅登录' }).locator('[data-preset-id]')).toHaveCount(2);
  const codex = dialog.locator('[data-preset-id="openai-codex"]');
  await expect(codex).toBeDisabled();
  await expect(codex).toHaveCSS('color', await resolveColor(page, '#6f6558'));
  await evidenceShot(page, 'provider-picker.png');

  await dialog.getByLabel('搜索服务商...').fill('cloudflare');
  await expect(dialog.locator('[data-preset-id]')).toHaveCount(2);
  await expect(dialog.getByRole('group', { name: '云平台' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: '网关与聚合' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: '模型厂商' })).toHaveCount(0);
  await expect(dialog.getByRole('group', { name: '订阅登录' })).toHaveCount(0);
  // the custom endpoint stays reachable whatever the query
  await expect(dialog.getByRole('button', { name: '自定义端点' })).toBeVisible();
  await evidenceShot(page, 'provider-picker-search.png');
});
