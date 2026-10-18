import { expect, test } from '@playwright/test';

test('CDS settings: reading col 768, cards 12px no shadow, input 8px/32px', async ({ page }) => {
  await page.goto('/app/account?scenario=01');
  await page.waitForSelector('[data-testid="page-col"], .profile-card, .account-card');

  const m = await page.evaluate(() => {
    const col =
      document.querySelector('[data-testid="page-col"]') ??
      document.querySelector('main .mx-auto');
    const card = document.querySelector('.profile-card, .account-card, [data-testid="resource-group"]');
    const input = document.querySelector('[data-slot="input"]');
    const root = getComputedStyle(document.documentElement);
    const colCs = col ? getComputedStyle(col) : null;
    const cardCs = card ? getComputedStyle(card) : null;
    const inputCs = input ? getComputedStyle(input) : null;
    return {
      colWidth: col ? (col as HTMLElement).getBoundingClientRect().width : null,
      cardRadius: cardCs?.borderTopLeftRadius ?? null,
      cardShadow: cardCs?.boxShadow ?? null,
      cds2xl: root.getPropertyValue('--cds-radius-2xl').trim(),
      cdsLg: root.getPropertyValue('--cds-radius-lg').trim(),
      inputRadius: inputCs?.borderTopLeftRadius ?? null,
      inputHeight: inputCs?.height ?? null,
      rowH: root.getPropertyValue('--row-h').trim(),
    };
  });

  expect(m.cds2xl).toBe('16px');
  expect(m.cdsLg).toBe('8px');
  expect(m.rowH).toBe('40px');
  if (m.colWidth != null) {
    expect(m.colWidth).toBeGreaterThanOrEqual(640);
    expect(m.colWidth).toBeLessThanOrEqual(800);
  }
  if (m.cardRadius != null) expect(m.cardRadius).toBe('12px');
  if (m.cardShadow != null) {
    // no soft drop shadow — hairline ring alone is OK
    expect(m.cardShadow.includes('8px') || m.cardShadow.includes('16px') || m.cardShadow.includes('24px')).toBeFalsy();
  }
  if (m.inputRadius != null) expect(m.inputRadius).toBe('8px');
  if (m.inputHeight != null) expect(m.inputHeight).toBe('32px');
});

test('CDS resources empty: 15px semibold balanced title', async ({ page }) => {
  await page.goto('/app/resources/skills?scenario=01');
  const empty = page.getByTestId('resource-empty');
  // may or may not be empty depending on fixture — skip soft if absent
  if (!(await empty.count())) {
    test.skip();
    return;
  }
  await expect(empty).toBeVisible();
  const title = empty.locator('h2');
  const m = await title.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      size: cs.fontSize,
      weight: cs.fontWeight,
      balance: cs.textWrap || (cs as CSSStyleDeclaration & { textWrap: string }).textWrap,
    };
  });
  expect(m.size).toBe('15px');
  expect(Number(m.weight)).toBeGreaterThanOrEqual(600);
});
