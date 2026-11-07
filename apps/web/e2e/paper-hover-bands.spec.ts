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

  test(`machine ${theme}: focus-visible and active paint only the full row or a compact control`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.goto('/app/settings/machines?scenario=machines-master-detail');
    const item = page.getByTestId('machine-item').first();
    await expect(item).toBeVisible();
    await page.mouse.move(0, 0);

    const resting = (await painted(item)).map((entry) => entry.index);
    const stops: string[] = [];
    await item.getByTestId('machine-toggle').focus();
    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await item.evaluate((root) => root.contains(document.activeElement));
      if (!inside) continue;
      stops.push(await item.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? ''));
      expect(await shapes(item, resting), `focus-visible on ${stops.at(-1)}`).toEqual([]);
    }
    expect(stops).toContain('machine-toggle');
    expect(stops).toContain('machine-menu');

    const toggle = item.getByTestId('machine-toggle');
    await toggle.focus();
    await page.keyboard.press('Tab');
    await toggle.focus();
    expect((await fresh(item, resting)).filter((entry) => entry.outline), 'keyboard focus on the toggle must be painted').toHaveLength(1);

    for (const testid of ['machine-toggle', 'machine-accept-toggle', 'machine-menu']) {
      const target = item.getByTestId(testid);
      await target.hover();
      await page.mouse.down();
      await page.waitForTimeout(120);
      expect(await shapes(item, resting), `:active on ${testid}`).toEqual([]);
      await page.mouse.move(0, 0);
      await page.mouse.up();
    }

    await page.mouse.move(0, 0);
    await item.getByTestId('machine-toggle').click();
    await page.waitForTimeout(150);
    expect(await fresh(item, resting), 'a mouse click must not leave a focus ring').toEqual([]);
    const expanded = await item.getAttribute('data-expanded');
    await item.getByTestId('machine-item-status').click({ force: true });
    await expect(item).not.toHaveAttribute('data-expanded', expanded ?? '');
  });
}

async function painted(item: Locator) {
  return item.evaluate((root) => {
    const header = root.firstElementChild;
    if (header === null) throw new Error('machine item has no header');
    const row = header.getBoundingClientRect();
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const out: { index: number; name: string; outline: boolean; shadow: boolean; sameAsRow: boolean; compact: boolean }[] = [];
    for (const [index, el] of [header, ...header.querySelectorAll('*')].entries()) {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const outline =
        cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor !== 'rgba(0, 0, 0, 0)';
      const fill = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const shadow =
        cs.boxShadow !== 'none' &&
        cs.boxShadow.replaceAll(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px/g, '').replaceAll(/[, ]/g, '') !== '';
      if (!outline && !fill && !shadow) continue;
      const grow = outline ? parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset) : 0;
      const [x, y, w, h] = [box.x - grow, box.y - grow, box.width + 2 * grow, box.height + 2 * grow];
      const range = document.createRange();
      range.selectNodeContents(el);
      out.push({
        index,
        name: el.getAttribute('data-testid') ?? el.tagName,
        outline,
        shadow,
        sameAsRow: near(x, row.x) && near(y, row.y) && near(w, row.width) && near(h, row.height),
        compact: w <= Math.max(range.getBoundingClientRect().width + 16, 44) && w < row.width * 0.5,
      });
    }
    return out;
  });
}

async function fresh(item: Locator, resting: number[]) {
  return (await painted(item)).filter((entry) => !resting.includes(entry.index));
}

async function shapes(item: Locator, resting: number[]) {
  return (await fresh(item, resting)).filter((entry) => entry.shadow || !(entry.sameAsRow || entry.compact));
}
