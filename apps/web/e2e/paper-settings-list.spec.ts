import { expect, type Locator, type Page, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
});

interface CardProbe {
  hiddenChildren: number;
  rows: { h: number; top: string; bottom: string; bg: string; label: string }[];
  cardBg: string;
  cardShadow: string;
  border: string;
}

async function probe(card: Locator): Promise<CardProbe> {
  return card.evaluate((el) => {
    const swatch = document.createElement('div');
    swatch.style.color = 'var(--border)';
    document.body.append(swatch);
    const border = getComputedStyle(swatch).color;
    swatch.remove();
    const children = [...el.children] as HTMLElement[];
    return {
      hiddenChildren: children.filter((c) => c.getClientRects().length === 0).length,
      rows: children.map((row) => {
        const cs = getComputedStyle(row);
        return {
          h: row.getBoundingClientRect().height,
          top: cs.borderTopWidth,
          bottom: `${cs.borderBottomWidth} ${cs.borderBottomColor}`,
          bg: cs.backgroundColor,
          label: row.querySelector('.settings-label-text')?.textContent ?? '',
        };
      }),
      cardBg: getComputedStyle(el).backgroundColor,
      cardShadow: getComputedStyle(el).boxShadow,
      border,
    };
  });
}

function expectOneCardShape(p: CardProbe) {
  expect(p.hiddenChildren, 'F2: hidden sibling in the card').toBe(0);
  expect(p.rows[0]?.top, 'F2: divider at the card top').toBe('0px');
  for (const row of p.rows) expect(row.top).toBe('0px');
  const last = p.rows.at(-1);
  expect(last?.bottom.startsWith('0px'), 'F3: divider under the last row').toBe(true);
  for (const row of p.rows.slice(0, -1)) {
    expect(row.bottom, 'F4: 1px divider in --border between rows').toBe(`1px ${p.border}`);
  }
  for (const row of p.rows) expect(row.bg, 'F5: row fill').toBe('rgba(0, 0, 0, 0)');
  expect(p.cardBg).toBe('rgb(254, 254, 251)');
  expect(p.cardShadow, 'F7: 1px outline at 2x').toContain(`${p.border} 0px 0px 0px 1px`);
  expect(
    p.rows.map((r) => r.label),
    'F6: name row inside the card',
  ).not.toContain('名称');
}

function headerName(page: Page, scope: string) {
  return page.locator(`${scope} .settings-header h2`);
}

test('account: two equal 52px rows, dividers between rows only, name above the card', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=13');
  const card = page.locator('.account-card');
  await expect(card).toBeVisible();
  const p = await probe(card);
  expect(p.rows.map((r) => r.label)).toEqual(['语言', '推送通知']);
  expect(
    p.rows.map((r) => r.h),
    'F1: equal row heights',
  ).toEqual([52, 52]);
  expectOneCardShape(p);
  await expect(headerName(page, '[data-route="account"]')).toHaveText('Xmon Dai');

  // The header sits above the card, not inside it.
  const headerBottom = await page
    .locator('.account-header')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const cardTop = await card.evaluate((el) => el.getBoundingClientRect().top);
  expect(headerBottom).toBeLessThan(cardTop);
});

test('account: editing the name keeps the card untouched (no row appears)', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  await page.getByRole('button', { name: '编辑名称' }).click();
  await expect(page.locator('.account-header').getByRole('textbox')).toBeFocused();
  const p = await probe(page.locator('.account-card'));
  expect(p.rows).toHaveLength(2);
  expectOneCardShape(p);
});

test('agent overview: same card shape; one-line rows are 52px, two-line rows grow', async ({
  page,
}) => {
  await page.goto('/app/resources/agents/r3-builder?scenario=agent-detail');
  const card = page.locator('.agent-overview .settings-card');
  await expect(card).toBeVisible();
  const p = await probe(card);
  expect(p.rows.map((r) => r.label)).toEqual(['职责', '默认 skill', '运行时', '模型', '思考强度']);
  expectOneCardShape(p);
  for (const row of p.rows) expect(row.h).toBeGreaterThanOrEqual(52);
  expect(p.rows.slice(1).map((r) => r.h)).toEqual([52, 52, 52, 52]);
  await expect(headerName(page, '.agent-overview')).toHaveText('r3-builder');
});
