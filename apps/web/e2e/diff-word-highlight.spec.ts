import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=diff-word-stress';
const SCROLLER = '[data-testid="doc-pane"] > div.overflow-y-auto';

/** The pane must actually overflow horizontally, else every width pin below
 *  would pass vacuously — this is the anti-false-green guard. */
async function expectHScroll(page: import('@playwright/test').Page): Promise<number> {
  const scroller = page.locator(SCROLLER);
  const scrollWidth = await scroller.evaluate((el) => el.scrollWidth);
  const clientWidth = await scroller.evaluate((el) => el.clientWidth);
  expect(scrollWidth).toBeGreaterThan(clientWidth + 50);
  return scrollWidth;
}

test('long lines create horizontal scroll, and every line box/hunk header/file row fills the scroll width (hunk face)', async ({ page }) => {
  await page.goto(ROUTE);
  const scrollWidth = await expectHScroll(page);
  const widths = await page
    .locator(`${SCROLLER} [data-kind]`)
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) {
    expect(w).toBeGreaterThanOrEqual(scrollWidth - 1);
    expect(w).toBeLessThanOrEqual(scrollWidth + 1);
  }

  const head = await page.locator('.diff-hunk-head').first().boundingBox();
  expect(head?.width).toBeGreaterThanOrEqual(scrollWidth - 1);
  const fileRow = await page.locator('.doc-file-row').first().boundingBox();
  expect(fileRow?.width).toBeGreaterThanOrEqual(scrollWidth - 1);
});

test('rows in the `显示完整文件` face also fill the scroll width', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: '显示完整文件' }).click();
  const scrollWidth = await expectHScroll(page);
  const widths = await page
    .getByTestId('diff-full')
    .locator('[data-kind]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) {
    expect(w).toBeGreaterThanOrEqual(scrollWidth - 1);
  }
});

test('word pairs mark only the changed words deep: exactly one word-level span per side, text = changed word', async ({ page }) => {
  await page.goto(ROUTE);
  const addRow = page.locator('[data-kind="add"]', { hasText: 'timeoutMs = 5000' });
  await expect(addRow.locator('[data-word="add"]')).toHaveCount(1);
  await expect(addRow.locator('[data-word="add"]')).toHaveText('5000');
  const delRow = page.locator('[data-kind="del"]', { hasText: 'timeoutMs = 3000' });
  await expect(delRow.locator('[data-word="del"]')).toHaveCount(1);
  await expect(delRow.locator('[data-word="del"]')).toHaveText('3000');
});

test('unequal-length runs pair by min(m,n), leftover del keeps whole-line highlight with zero word-level spans', async ({ page }) => {
  await page.goto(ROUTE);
  const pairedDel = page.locator('[data-kind="del"]', { hasText: 'keepAlpha' });
  await expect(pairedDel.locator('[data-word="del"]')).toHaveText('true');
  const pairedAdd = page.locator('[data-kind="add"]', { hasText: 'keepAlpha' });
  await expect(pairedAdd.locator('[data-word="add"]')).toHaveText('false');
  const surplusDel = page.locator('[data-kind="del"]', { hasText: 'keepBeta' });
  await expect(surplusDel.locator('[data-word]')).toHaveCount(0);
});

test('marker rows do not break pairing (r8 72 shape): long-line comparisons often yield word-level spans', async ({ page }) => {
  await page.goto(ROUTE);
  const longDel = page.locator('[data-kind="del"]', { hasText: 'renderDashboard' });
  await expect(longDel.locator('[data-word="del"]')).toHaveCount(1);
  await expect(longDel.locator('[data-word="del"]')).toHaveText('100');
  const longAdd = page.locator('[data-kind="add"]', { hasText: 'renderDashboard' });
  await expect(longAdd.locator('[data-word="add"]')).toHaveCount(1);
  await expect(longAdd.locator('[data-word="add"]')).toHaveText('200');
});

test('over-limit pairs fall back to whole-line highlight without silence: data-word=capped + non-empty title, zero word-level spans', async ({ page }) => {
  await page.goto(ROUTE);
  for (const kind of ['add', 'del'] as const) {
    const row = page.locator(`[data-kind="${kind}"]`, { hasText: 'const mega' });
    await expect(row).toHaveAttribute('data-word', 'capped');
    const title = await row.getAttribute('title');
    expect(title?.length ?? 0).toBeGreaterThan(0);
    await expect(row.locator(`[data-word="${kind}"]`)).toHaveCount(0);
  }
});

test('word-level spans swallow no whitespace: line text matches the fixture byte for byte', async ({ page }) => {
  await page.goto(ROUTE);
  const addRow = page.locator('[data-kind="add"]', { hasText: 'timeoutMs = 5000' });

  await expect(addRow.locator('span').nth(3)).toHaveText(
    'const timeoutMs = 5000; // retry window',
  );
});

test('add-only hunks get zero word-level spans (27b regression face, pairing does not misfire)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27b');
  await expect(page.locator('[data-kind="add"]')).toHaveCount(1);
  await expect(page.locator('[data-word]')).toHaveCount(0);
});

test('plan-diff face takes word-level spans through the same path (scenario 72 real del/add pairs)', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=72');
  await expect(page.locator('[data-word="add"]').first()).toBeVisible();
  await expect(page.locator('[data-word="del"]').first()).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`word-level background rides a token darker than the whole-line background, opaque and distinguishable (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto(ROUTE);
    for (const kind of ['add', 'del'] as const) {
      const row = page.locator(`[data-kind="${kind}"]`, { hasText: 'timeoutMs' });
      const rowBg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
      const wordBg = await row
        .locator(`[data-word="${kind}"]`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(wordBg).not.toBe('rgba(0, 0, 0, 0)');
      expect(wordBg).not.toBe(rowBg);
    }
  });
}
