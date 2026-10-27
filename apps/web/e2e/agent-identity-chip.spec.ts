import { expect, type Page, test } from '@playwright/test';

const SCENARIO = '/app?view=board&scenario=chief-agent-chip';
const AGENT_HREF = '/app/resources/agents/r3-builder';

function stubDicebear(page: Page) {
  return page.route('**/api.dicebear.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
    }),
  );
}

test.describe('drawer robot row identity chip (fixture, #741 gap 1)', () => {
  test.beforeEach(async ({ page }) => {
    await stubDicebear(page);
    await page.goto(SCENARIO);
    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();

    await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  });

  test('F-E1/E2/E10: avatar+name side by side in a chain, href points at the Agent settings page, geometry canon does not drift', async ({
    page,
  }) => {

    const chip = page.getByTestId('chief-stream').getByRole('link', { name: 'r3-builder' });
    await expect(chip).toHaveCount(1);

    const img = chip.locator('img');
    await expect(img).toBeVisible();
    await expect(chip.getByText('r3-builder')).toHaveText('r3-builder');

    await expect(chip).toHaveAttribute('href', `${AGENT_HREF}?view=board&scenario=chief-agent-chip`);

    const box = await img.boundingBox();
    expect(box?.width).toBe(24);
    expect(box?.height).toBe(24);
    const fontSize = await chip
      .getByText('r3-builder')
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('12px');
  });

  test('F-E9: hover only changes the cursor, invents no background state (reference-site canon)', async ({ page }) => {
    const chip = page.getByTestId('chief-stream').getByRole('link', { name: 'r3-builder' });
    const bgBefore = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    await chip.hover();
    const bgAfter = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgAfter).toBe(bgBefore);
    expect(await chip.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
  });

  test('F-E3: click → SPA navigation into the Agent settings page, detail page resolves the real record', async ({ page }) => {
    await page.getByTestId('chief-stream').getByRole('link', { name: 'r3-builder' }).click();
    await page.waitForURL((u) => u.pathname === AGENT_HREF);

    await expect(page.locator('.agent-detail')).toBeVisible();
    await expect(page.locator('.agent-missing')).toHaveCount(0);
    await expect(page.locator('.agent-detail')).toContainText('r3-builder');

    await expect(page.locator('.agent-tabs')).toBeVisible();
  });

  test('F-E4: keyboard reachable — focus lands on the chip, Enter activates navigation', async ({ page }) => {
    const chip = page.getByTestId('chief-stream').getByRole('link', { name: 'r3-builder' });
    await chip.focus();
    const focused = await chip.evaluate((el) => el === document.activeElement);
    expect(focused).toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => u.pathname === AGENT_HREF);
  });
});

test.describe('agent mention chip (fixture, #741 gap 2)', () => {
  test.beforeEach(async ({ page }) => {
    await stubDicebear(page);
  });

  test('F-E5: drawer-face agent mention chips form links with click navigation (same recipe as F-R13)', async ({ page }) => {
    await page.goto(SCENARIO);
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const chip = page.getByTestId('chief-stream').locator('.mention-chip--agent');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText('r5-scribe');

    await expect(chip).toHaveAttribute('href', '/app/resources/agents/a1');
    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/resources/agents/a1');
  });

  test('F-E6: detail page transcript face follows the same law (second consumer of the single-source segments)', async ({ page }) => {
    await page.goto('/app/todo/r3-legacy-1?scenario=chief-agent-chip');

    const chip = page.locator('.detail-center .mention-chip--agent');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('href', '/app/resources/agents/a1');
    await chip.click();
    await page.waitForURL((u) => u.pathname === '/app/resources/agents/a1');
  });

  test('F-E7: skill/project/machine mentions stay lazy spans (literal negative cases)', async ({ page }) => {
    await page.goto(SCENARIO);
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');
    for (const kind of ['skill', 'project', 'machine'] as const) {
      const chip = stream.locator(`.mention-chip--${kind}`);
      await expect(chip, kind).toHaveCount(1);
      expect(await chip.evaluate((el) => el.tagName), kind).toBe('SPAN');
      await expect(chip, kind).not.toHaveAttribute('href', /.*/);
    }

    await expect(stream.locator('.mention-chip--todo')).toHaveAttribute(
      'href',
      '/app/todo/r3-legacy-1',
    );
  });
});

test.describe('lazy face zero change (#741 negative case)', () => {
  test('F-E8: robot rows without an agent projection keep the dashed glyph, zero anchors (frozen capture face r5 114)', async ({
    page,
  }) => {
    await stubDicebear(page);
    await page.goto('/app?view=board&scenario=114');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');

    await expect(stream.getByTestId('chief-msg').locator('> svg')).toHaveCount(1);

    await expect(stream.getByRole('link')).toHaveCount(0);
    await expect(
      stream.getByTestId('chief-msg').filter({ has: page.getByRole('link') }),
    ).toHaveCount(0);
  });
});
