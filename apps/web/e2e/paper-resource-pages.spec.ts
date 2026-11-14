import { expect, type Page, test } from '@playwright/test';

const light = async (page: Page, url: string) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
  await page.goto(url);
};

for (const [name, url] of [
  ['skills', '/app/resources/skills?scenario=01'],
  ['mcp', '/app/resources/mcp-servers?scenario=01'],
  ['secrets', '/app/resources/secrets?scenario=01'],
  ['machines', '/app/resources/machines?scenario=01'],
] as const) {
  test(`${name} empty state: bare ink-3 icon, no tile`, async ({ page }) => {
    await light(page, url);
    const empty = page.locator('.empty-state');
    await expect(empty).toBeVisible();
    const face = await empty.evaluate((el) => {
      const svg = el.querySelector('svg');
      const media = svg?.parentElement;
      return {
        mediaBg: media ? getComputedStyle(media).backgroundColor : null,
        iconSize: svg?.getBoundingClientRect().width ?? null,
      };
    });
    expect(face.mediaBg).toBe('rgba(0, 0, 0, 0)');
    expect(face.iconSize).toBe(32);
  });
}

for (const [name, url, rows] of [
  ['skills', '/app/resources/skills?scenario=06', 1],
  ['mcp', '/app/resources/mcp-servers?scenario=07', 1],
  ['secrets', '/app/resources/secrets?scenario=secrets-list', 2],
] as const) {
  test(`${name} list: one settings card of 52px rows, 14px corner`, async ({ page }) => {
    await light(page, url);
    const cards = page.locator('[data-testid="page-col"] .settings-card');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveCSS('border-top-left-radius', '12px');
    const heights = await cards.evaluate((el) =>
      [...el.children].map((row) => row.getBoundingClientRect().height),
    );
    expect(heights).toEqual(Array.from({ length: rows }, () => 52));
  });
}

test('machines: `添加 Runner` is the plus beside the list heading, no dashed full-width bar', async ({ page }) => {
  await light(page, '/app/resources/machines?scenario=06&machine=TlZ2sSD4EJCxjNJqVhdo_');
  const add = page.getByTestId('settings-content').getByRole('button', { name: '添加 Runner' });
  await expect(add).toBeVisible();
  await expect(page.locator('button.border-dashed')).toHaveCount(0);
  const local = page.getByTestId('machine-item').first();
  await expect(local.getByTestId('machine-item-status')).toHaveText('在线');
  await expect(local.getByTestId('machine-accept-toggle')).toBeVisible();
});

for (const [name, url, open, submit] of [
  ['secret', '/app/resources/secrets?scenario=01', '新建', '添加密钥'],
  ['skill', '/app/resources/skills?scenario=06', '新建', '新建技能'],
  ['skill import', '/app/resources/skills?scenario=06', '导入', '导入'],
] as const) {
  test(`${name} dialog: FormActions footer, primary is not a full-width bar`, async ({ page }) => {
    await light(page, url);
    await page.getByTestId('page-toolbar').getByRole('button', { name: open, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const foot = dialog.getByTestId('dialog-foot');
    const primary = foot.getByRole('button', { name: submit, exact: true });
    await expect(primary).toHaveCSS('height', '32px');
    await expect(foot.getByRole('button', { name: '取消' })).toBeVisible();
    const [footBox, primaryBox] = await Promise.all([foot.boundingBox(), primary.boundingBox()]);
    expect(primaryBox!.width).toBeLessThan(footBox!.width / 2);
  });
}
