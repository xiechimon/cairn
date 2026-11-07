import { expect, type Locator, type Page, test } from '@playwright/test';

async function backgrounds(row: Locator) {
  return row.evaluate((root) =>
    [root, ...root.querySelectorAll('*')].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        name: el.getAttribute('data-testid') ?? el.tagName,
        background: getComputedStyle(el).backgroundColor,
        box: [box.x, box.y, box.width, box.height],
      };
    }),
  );
}

async function assertFlatRow(page: Page, row: Locator) {
  await row.scrollIntoViewIfNeeded();
  const targets = row.locator('button, a, [role="switch"]');
  for (const target of [row, ...(await targets.all())]) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(180);
    const before = await backgrounds(row);
    await target.hover();
    await page.waitForTimeout(180);
    const after = await backgrounds(row);
    for (let i = 0; i < after.length; i++) {
      const previous = before[i];
      const current = after[i];
      if (previous === undefined || current === undefined) throw new Error('row changed during hover');
      if (previous.background === current.background) continue;
      const rowBox = after[0]?.box;
      expect(rowBox).toBeDefined();
      expect(
        current.box.every((value, index) => Math.abs(value - (rowBox?.[index] ?? 0)) <= 1),
        `V21: ${current.name} changes background on only part of the row: ${JSON.stringify(current)}`,
      ).toBe(true);
    }
  }
}

const LISTS = [
  ['machines', '/app/settings/machines?scenario=machines-master-detail', '[data-testid="machine-item"]'],
  ['providers', '/app/settings/providers?scenario=providers-fleet', '[data-testid="provider-instance"]'],
  ['MCP', '/app/resources/mcp-servers?scenario=07', '[data-testid="resource-row"]'],
  ['skills', '/app/resources/skills?scenario=06', '[data-testid="resource-row"]'],
  ['API keys', '/app/api-keys?scenario=api-keys-created', '.settings-card > .settings-row'],
  ['secrets', '/app/resources/secrets?scenario=secrets-list', '[data-testid="resource-row"]'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const [name, url, selector] of LISTS) {
    test(`${name} ${theme}: hover never paints a partial row`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await page.goto(url);
      const rows = page.locator(selector);
      await expect(rows.first()).toBeVisible();
      for (const row of await rows.all()) await assertFlatRow(page, row);
    });
  }

  test(`machine ${theme}: keyboard focus is an outline without a band`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto('/app/settings/machines?scenario=machines-master-detail');
    const toggle = page.getByTestId('machine-toggle').first();
    await expect(toggle).toBeVisible();
    await page.mouse.move(0, 0);
    const resting = await toggle.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      shadow: getComputedStyle(el).boxShadow,
    }));
    await page.keyboard.press('Tab');
    await toggle.focus();
    await expect(toggle).toHaveCSS('outline-style', 'solid');
    await expect(toggle).toHaveCSS('outline-width', '2px');
    await expect(toggle).toHaveCSS('background-color', resting.background);
    const shadow = await toggle.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(
      shadow === 'none' ||
        shadow.replaceAll(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px/g, '').replaceAll(/[, ]/g, '') === '',
    ).toBe(true);
  });
}
