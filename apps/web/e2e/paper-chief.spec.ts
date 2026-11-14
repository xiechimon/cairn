import { expect, type Locator, type Page, test } from '@playwright/test';

const GATED = '/app?scenario=100';
const READY = '/app?scenario=111';
const THREAD = '/app?scenario=114';
const QUESTION = '/app?scenario=chief-question';
const SETTINGS = (tab: string) => `/app?scenario=${tab}`;

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

function setTheme(page: Page, theme: 'light' | 'dark') {
  return page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
}

function probe(page: Page, prop: 'color' | 'backgroundColor' | 'fontFamily', value: string) {
  return page.evaluate(
    ([p, v]) => {
      const el = document.createElement('span');
      (el.style as unknown as Record<string, string>)[p] = v;
      document.body.append(el);
      const out = (getComputedStyle(el) as unknown as Record<string, string>)[p];
      el.remove();
      return out;
    },
    [prop, value] as const,
  );
}

function token(page: Page, name: string) {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
}

function css(locator: Locator, prop: string) {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

async function openHome(page: Page, url: string) {
  await page.goto(url);
  const home = page.getByTestId('home-c');
  await expect(home).toBeVisible();
  return home;
}

for (const theme of ['light', 'dark'] as const) {
  test(`home: Paper gate banner (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    const win = await openHome(page, GATED);
    const secondary = await probe(page, 'backgroundColor', 'var(--secondary)');
    const banner = win.getByTestId('chief-gate');
    await expect(banner, 'W2').toHaveCSS('border-top-left-radius', await token(page, '--radius-card'));
    expect(await css(banner, 'background-color'), 'W2: not tinted').not.toBe(secondary);
    expect(await css(banner, 'box-shadow'), 'W2: 1px ring').toContain('0px 0px 0px 1px');
    const gateButton = banner.getByRole('button', { name: '设置' });
    expect((await gateButton.boundingBox())?.height, 'W2').toBe(32);
    await expect(gateButton, 'W2').toHaveCSS('border-top-left-radius', '8px');
  });

  test(`home: bound composer and stream type keys (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    let win = await openHome(page, READY);
    await expect(win.getByTestId('chief-gate'), 'W2: bound has no gate').toHaveCount(0);
    await expect(win.getByTestId('chief-composer-input'), 'W5').toHaveCSS('font-size', '14px');

    win = await openHome(page, THREAD);
    const note = win.getByTestId('chief-stream').getByTestId('chief-note').first();
    await expect(note, 'W5').toHaveCSS('font-size', '13px');
    const meta = win
      .getByTestId('chief-msg-foot')
      .first()
      .locator('[data-slot="message-toolbar-meta"]');
    await expect(meta, 'W5').toHaveCSS('font-size', '12px');
    await expect(win.getByTestId('chief-tools-toggle'), 'W5: the stream carries no steps').toHaveCount(0);
  });

  test(`settings: Paper top bar, routing card and tab-specific empty states (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto(SETTINGS('101'));
    const serif = await probe(page, 'fontFamily', 'var(--font-source-serif)');

    const heading = page.getByRole('heading', { name: 'Coordinator 设置' });
    await expect(heading, 'S1').toHaveCSS('font-family', serif);
    await expect(heading, 'S1').toHaveCSS('font-size', '24px');
    const bar = page.getByTestId('chief-settings-topbar');
    expect((await bar.boundingBox())?.height, 'S1').toBe(56);
    await expect(bar, 'S1').toHaveCSS('border-bottom-width', '1px');
    const back = bar.getByRole('button', { name: '返回' });
    const backBox = await back.boundingBox();
    const headingBox = await heading.boundingBox();
    const barBox = await bar.boundingBox();
    expect(headingBox?.x ?? 0, 'S1: title sits after the back link').toBeGreaterThan(
      backBox?.x ?? 0,
    );
    expect(
      (headingBox?.x ?? 0) - (barBox?.x ?? 0),
      'S1: left-aligned, not centered',
    ).toBeLessThan(80);
    expect((await page.getByTestId('chief-settings-col').boundingBox())?.width, 'S1').toBe(768);

    const cards = page.locator('.settings-card');
    await expect(cards, 'S2').toHaveCount(1);
    await expect(cards, 'S2').toHaveCSS('border-top-left-radius', await token(page, '--radius-card'));
    const routingRow = cards.getByTestId('chief-routing-row');
    await expect(routingRow, 'S2').toHaveCount(1);
    await expect(routingRow, 'S2').toContainText('模型与机器');
    const heights = await cards
      .locator('> .settings-row')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length, 'S2').toBe(1);
    for (const h of heights) expect(h, 'S2').toBeGreaterThanOrEqual(52);
    const modelRow = cards.locator('> .settings-row').first();
    await expect(modelRow, 'S2: no bottom edge on sole row').toHaveCSS('border-bottom-width', '0px');
    await expect(modelRow, 'S2: no top edge').toHaveCSS('border-top-width', '0px');

    await page.goto(SETTINGS('102'));
    const charterCard = page.locator('.settings-card');
    await expect(charterCard.getByText(/尚无章程/), 'S3').toBeVisible();
    await expect(page.getByTestId('chief-default-rule'), 'S3').toContainText('你提需求、做架构决策');
    const edit = page.getByRole('button', { name: '编辑' });
    expect((await edit.boundingBox())?.height, 'S3').toBe(32);
    await expect(edit, 'S3').toHaveCSS(
      'background-color',
      await probe(page, 'backgroundColor', 'var(--primary)'),
    );

    await page.goto(SETTINGS('103'));
    await expect(page.getByRole('heading', { name: '自动记忆' }), 'S3').toBeVisible();
    await expect(page.getByTestId('chief-settings-col').locator('.settings-card'), 'S3').toHaveCount(0);

    await page.goto(SETTINGS('104'));
    await expect(page.locator('.settings-card').getByText(/暂无跟进事项/), 'S3').toBeVisible();
  });

  test(`question chips: reply bubble face, quiet header, chip type (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    const win = await openHome(page, QUESTION);
    const fill = await probe(page, 'backgroundColor', 'var(--reply-bubble-fill)');

    const pending = win.locator('[data-testid="chief-question-chips"][data-status="pending"]');
    await pending.scrollIntoViewIfNeeded();
    await expect(pending.getByTestId('chief-question-text'), 'Q1').toHaveCSS('background-color', fill);
    await expect(pending.getByTestId('chief-question-header'), 'Q1').toHaveCount(0);
    await expect(pending.getByTestId('chief-question-option-0-0'), 'Q1').toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );

    const done = win.locator('[data-slot="user-bubble"][data-question-answer="q-answered"]');
    await expect(done, 'Q1').toHaveText('桌面浏览器');
    await expect(done.locator('svg'), 'Q1').toHaveCount(0);
    await expect(done, 'Q1').toHaveCSS(
      'background-color',
      await probe(page, 'backgroundColor', 'var(--bubble-fill)'),
    );
    await expect(win.getByTestId('chief-question-line'), 'Q1').toHaveCount(0);
    const asked = win.locator('[data-testid="chief-question-asked"][data-request-id="q-answered"]');
    await expect(asked.getByTestId('chief-reply-bubble'), 'Q1').toHaveText('先做哪一端？');
    await expect(asked.getByTestId('chief-reply-bubble'), 'Q1').toHaveCSS('background-color', fill);

    await expect(pending.getByTestId('chief-question-text'), 'Q2').toHaveCSS('font-size', '14px');
    await expect(pending.getByTestId('chief-question-option-0-0'), 'Q2').toHaveCSS(
      'font-size',
      '14px',
    );
  });
}
