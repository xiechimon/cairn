// Resource pages on the Paper page patterns
// (apps/web/DESIGN.md 页面模式). Failure modes pinned here:
// 1. An empty state grows a tinted icon tile again (orange / beige block).
// 2. A list falls back to one card per item, or its rows lose the 52px
//    settings-row height or the 10px card corner.
// 3. The machines page brings back the full-width dashed 添加机器 bar.
// 4. The providers runtime tabs fall back to their own pill skin instead of
//    the Paper segmented face (canvas track, white chosen tab with a ring).
// 5. A create dialog brings back a full-width submit bar.
// 6. A status loses its label (online = green dot + 在线).

import { expect, type Page, test } from '@playwright/test';

const light = async (page: Page, url: string) => {
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
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
    expect(face.iconSize).toBe(24);
  });
}

for (const [name, url, rows] of [
  ['skills', '/app/resources/skills?scenario=06', 1],
  ['mcp', '/app/resources/mcp-servers?scenario=07', 1],
  ['secrets', '/app/resources/secrets?scenario=agent-detail-secrets', 2],
  ['machines', '/app/resources/machines?scenario=06', 2],
] as const) {
  test(`${name} list: one settings card of 52px rows, 10px corner`, async ({ page }) => {
    await light(page, url);
    const cards = page.locator('[data-testid="page-col"] .settings-card');
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveCSS('border-top-left-radius', '10px');
    const heights = await cards.evaluate((el) =>
      [...el.children].map((row) => row.getBoundingClientRect().height),
    );
    expect(heights).toEqual(Array.from({ length: rows }, () => 52));
  });
}

test('machines: 添加机器 sits in the top bar, no dashed full-width bar', async ({ page }) => {
  await light(page, '/app/resources/machines?scenario=06');
  const add = page.getByTestId('page-topbar').getByRole('button', { name: '添加机器' });
  await expect(add).toBeVisible();
  await expect(page.locator('[data-testid="page-col"] button.border-dashed')).toHaveCount(0);
  const local = page.locator('div[data-kind="local"]');
  await expect(local).toContainText('在线');
  await expect(local.locator('[data-on]')).toHaveCSS('background-color', 'rgb(95, 143, 90)');
});

test('providers runtime tabs: canvas track, chosen tab white with a 1px ring', async ({ page }) => {
  await light(page, '/app/resources/providers?scenario=06');
  const list = page.getByRole('tablist', { name: '模型服务' });
  await expect(list).toHaveCSS('background-color', 'rgb(243, 238, 229)');
  const chosen = list.getByRole('tab', { selected: true });
  await expect(chosen).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const ring = await chosen.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).toContain('0px 0px 0px 1px');
  await expect(chosen).toHaveCSS('height', '28px');
});

for (const [name, url, open, submit] of [
  ['secret', '/app/resources/secrets?scenario=01', '新建', '添加密钥'],
  ['skill', '/app/resources/skills?scenario=06', '新建', '新建技能'],
  ['skill import', '/app/resources/skills?scenario=06', '导入', '导入'],
] as const) {
  test(`${name} dialog: FormActions footer, primary is not a full-width bar`, async ({ page }) => {
    await light(page, url);
    await page.getByTestId('page-topbar').getByRole('button', { name: open, exact: true }).click();
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
