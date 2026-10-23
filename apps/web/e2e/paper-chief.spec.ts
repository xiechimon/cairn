import { expect, type Locator, type Page, test } from '@playwright/test';

// Chief window, 总管设置 and the question card on the Paper patterns
// (DESIGN.md, issue #1398). The window keeps its ADR 0013 frame (380x600,
// --radius-window, FAB); what changes is what sits inside it.
//
// Failure modes, each pinned below:
//  W1 the thread title drifts off the dialog heading face (16px serif 500)
//     or off the 16px window inset
//  W2 the gate banner goes back to a tinted block, or 设置 leaves the 32px
//     primary button shape
//  W3 the hero title leaves the heading face, example cards go back to
//     tinted blocks, or their icons sit on a tinted tile again
//  W4 the thread switcher leaves the Paper menu face (10px corners, 32px
//     rows, 13.5px text)
//  W5 stream meta leaves the type keys (12px notes and foot, 11.5px tool
//     rows, 13.5px composer)
//  S1 总管设置 loses the Paper top bar (56px, hairline, serif 18px title on
//     the left) or the 768px column
//  S2 the Agent tab goes back to two tinted blocks instead of one
//     --radius-card settings card of >= 52px rows
//  S3 empty tabs drop out of the settings card, or 编辑 leaves the 32px
//     primary button
//  Q1 the question card leaves the card face (--radius-card, card ground),
//     or its status stops being icon + colour + word
//  Q2 question and option text leave the type keys (14px 500 question,
//     13.5px options, 11.5px step header)

const GATED = '/app?scenario=100';
const READY = '/app?scenario=111';
const THREAD = '/app?scenario=114';
const SWITCHER = '/app?scenario=116';
const QUESTION = '/app?scenario=chief-question';
const SETTINGS = (tab: string) => `/app?scenario=${tab}`;

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

function setTheme(page: Page, theme: 'light' | 'dark') {
  return page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
}

/** Resolve a CSS expression for one property through a probe element, so
 *  token values are compared the way the computed style reports them. */
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

async function openWindow(page: Page, url: string) {
  await page.goto(url);
  const win = page.locator('aside.chief-drawer');
  await expect(win).toBeVisible();
  // The entrance is a fade + scale; measure the settled box.
  await win.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
  );
  return win;
}

for (const theme of ['light', 'dark'] as const) {
  test(`window: heading face, Paper gate banner and hero cards (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    const win = await openWindow(page, GATED);
    const serif = await probe(page, 'fontFamily', 'var(--font-source-serif)');
    const card = await probe(page, 'backgroundColor', 'var(--card)');
    const secondary = await probe(page, 'backgroundColor', 'var(--secondary)');

    const chip = win.getByRole('button', { name: '主题', exact: true });
    const title = chip.locator('span').first();
    await expect(title, 'W1').toHaveCSS('font-family', serif);
    await expect(title, 'W1').toHaveCSS('font-size', '16px');
    await expect(title, 'W1').toHaveCSS('font-weight', '500');
    const winBox = await win.boundingBox();
    const chipBox = await chip.boundingBox();
    expect((chipBox?.x ?? 0) - (winBox?.x ?? 0), 'W1').toBeCloseTo(16, 0);

    const banner = win.getByTestId('chief-gate');
    await expect(banner, 'W2').toHaveCSS('border-top-left-radius', await token(page, '--radius-card'));
    expect(await css(banner, 'background-color'), 'W2: not tinted').not.toBe(secondary);
    expect(await css(banner, 'box-shadow'), 'W2: 1px ring').toContain('0px 0px 0px 1px');
    const gateButton = banner.getByRole('button', { name: '设置' });
    expect((await gateButton.boundingBox())?.height, 'W2').toBe(32);
    await expect(gateButton, 'W2').toHaveCSS('border-top-left-radius', '8px');

    const hero = win.getByRole('heading', { name: '选择一个主题开始' });
    await expect(hero, 'W3').toHaveCSS('font-family', serif);
    await expect(hero, 'W3').toHaveCSS('font-size', '16px');
    const example = win.getByTestId('chief-examples').getByRole('button').first();
    await expect(example, 'W3').toHaveCSS('border-top-left-radius', await token(page, '--radius-card'));
    await expect(example, 'W3').toHaveCSS('background-color', card);
    const tile = example.locator('svg').first().locator('xpath=..');
    expect(await css(tile, 'background-color'), 'W3: bare icon').toBe('rgba(0, 0, 0, 0)');
  });

  test(`window: bound hero, switcher menu and stream type keys (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    let win = await openWindow(page, READY);
    await expect(win.getByTestId('chief-gate'), 'W2: bound has no gate').toHaveCount(0);
    await expect(win.getByTestId('chief-composer-input'), 'W5').toHaveCSS('font-size', '13.5px');

    win = await openWindow(page, SWITCHER);
    const menu = win.getByRole('menu');
    await expect(menu, 'W4').toHaveCSS(
      'border-top-left-radius',
      await token(page, '--radius-popover'),
    );
    const row = menu.getByRole('menuitem').first();
    expect((await row.boundingBox())?.height, 'W4').toBe(32);
    await expect(row, 'W4').toHaveCSS('font-size', '13.5px');

    win = await openWindow(page, THREAD);
    const note = win.getByTestId('chief-stream').locator('[data-slot="marker"]').first();
    await expect(note, 'W5').toHaveCSS('font-size', '12px');
    const foot = win.getByTestId('chief-msg-foot').first();
    await expect(foot, 'W5').toHaveCSS('font-size', '12px');
    await win.getByRole('button', { name: '展开过程' }).click();
    const toolRow = win.getByTestId('chief-turn-tools').locator('> div').first();
    await expect(toolRow, 'W5').toHaveCSS('font-size', '11.5px');
  });

  test(`settings: Paper top bar, one settings card, empty rows in the card (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto(SETTINGS('101'));
    const serif = await probe(page, 'fontFamily', 'var(--font-source-serif)');

    const heading = page.getByRole('heading', { name: '总管设置' });
    await expect(heading, 'S1').toHaveCSS('font-family', serif);
    await expect(heading, 'S1').toHaveCSS('font-size', '18px');
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
    await expect(cards.getByRole('button', { name: '未设置' }), 'S2').toHaveCount(1);
    await expect(cards.getByTestId('chief-follows-agent'), 'S2').toHaveCount(1);
    const heights = await cards
      .locator('> .settings-row')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length, 'S2').toBe(2);
    for (const h of heights) expect(h, 'S2').toBeGreaterThanOrEqual(52);
    // The divider between the two rows is drawn: the agent row is a button,
    // and a button's own transparent border must not hide the card's rule.
    const agentRow = cards.locator('> .settings-row').first();
    await expect(agentRow, 'S2: divider').toHaveCSS('border-bottom-width', '1px');
    await expect(agentRow, 'S2: divider').toHaveCSS(
      'border-bottom-color',
      await probe(page, 'color', 'var(--border)'),
    );
    await expect(agentRow, 'S2: no top edge').toHaveCSS('border-top-width', '0px');

    await page.goto(SETTINGS('102'));
    const charterCard = page.locator('.settings-card');
    await expect(charterCard.getByText(/尚无章程/), 'S3').toBeVisible();
    const edit = page.getByRole('button', { name: '编辑' });
    expect((await edit.boundingBox())?.height, 'S3').toBe(32);
    await expect(edit, 'S3').toHaveCSS(
      'background-color',
      await probe(page, 'backgroundColor', 'var(--primary)'),
    );

    for (const [tab, copy] of [
      ['103', /尚未选择 Agent/],
      ['104', /暂无跟进事项/],
    ] as const) {
      await page.goto(SETTINGS(tab));
      await expect(page.locator('.settings-card').getByText(copy), 'S3').toBeVisible();
    }
  });

  test(`question card: card face, status triad, type keys (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    const win = await openWindow(page, QUESTION);
    const card = await probe(page, 'backgroundColor', 'var(--card)');
    const accent = await probe(page, 'color', 'var(--card-button)');
    const ink3 = await probe(page, 'color', 'var(--text-tertiary)');

    const pending = win.locator('[data-testid="chief-question-card"][data-status="pending"]');
    await pending.scrollIntoViewIfNeeded();
    await expect(pending, 'Q1').toHaveCSS('border-top-left-radius', await token(page, '--radius-card'));
    await expect(pending, 'Q1').toHaveCSS('background-color', card);
    const waiting = pending.getByTestId('chief-question-status');
    await expect(waiting, 'Q1').toHaveText('等你回答');
    await expect(waiting.locator('svg'), 'Q1').toHaveCount(1);
    await expect(waiting, 'Q1').toHaveCSS('color', accent);

    const answered = win.locator('[data-testid="chief-question-card"][data-status="answered"]');
    const done = answered.getByTestId('chief-question-status');
    await expect(done, 'Q1').toHaveText('已回答');
    await expect(done.locator('svg'), 'Q1').toHaveCount(1);
    await expect(done, 'Q1').toHaveCSS('color', ink3);

    await expect(pending.getByTestId('chief-question-text'), 'Q2').toHaveCSS('font-size', '14px');
    await expect(pending.getByTestId('chief-question-text'), 'Q2').toHaveCSS('font-weight', '500');
    await expect(pending.getByTestId('chief-question-step'), 'Q2').toHaveCSS(
      'font-size',
      '11.5px',
    );
    await expect(pending.getByTestId('chief-question-option-0-0'), 'Q2').toHaveCSS(
      'font-size',
      '13.5px',
    );
  });
}
