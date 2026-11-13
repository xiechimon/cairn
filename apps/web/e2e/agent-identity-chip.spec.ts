import { expect, type Page, test } from '@playwright/test';

const SCENARIO = '/app?scenario=chief-agent-chip';

function stubDicebear(page: Page) {
  return page.route('**/api.dicebear.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
    }),
  );
}

test.describe('Coordinator replies carry no identity row (D122)', () => {
  test.beforeEach(async ({ page }) => {
    await stubDicebear(page);
    await page.goto(SCENARIO);
    await expect(page.getByTestId('home-c')).toBeVisible();
  });

  test('no avatar or agent-name link sits above a Coordinator reply', async ({ page }) => {
    const stream = page.getByTestId('chief-stream');
    await expect(stream.getByTestId('chief-msg-col').first()).toBeVisible();
    await expect(stream.getByRole('link', { name: 'r3-builder' })).toHaveCount(0);
    await expect(stream.getByTestId('chief-msg-col').locator('a[href$="/agents/r3-builder"]')).toHaveCount(0);
  });
});

test.describe('agent mention in an old message (fixture, #741 gap 2)', () => {
  test.beforeEach(async ({ page }) => {
    await stubDicebear(page);
  });

  test('F-E5: a Coordinator agent mention is plain text, with no chip and no link', async ({ page }) => {
    await page.goto(SCENARIO);
    await expect(page.getByTestId('home-c')).toBeVisible();
    const stream = page.getByTestId('chief-stream');
    const mention = stream.locator('[data-slot="agent-mention"]');
    await expect(mention).toHaveCount(1);
    await expect(mention).toHaveText('r5-scribe');
    await expect(stream.locator('.mention-chip--agent')).toHaveCount(0);

    expect(await mention.evaluate((el) => el.tagName)).toBe('SPAN');
    await expect(mention).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(mention.locator('svg, img')).toHaveCount(0);
  });

  test('F-E6: side chat transcript face follows the same law (second consumer of the single-source segments)', async ({ page }) => {
    await page.goto('/app/todo/r3-legacy-1?scenario=chief-agent-chip');

    const mention = page.locator('.side-panel [data-slot="agent-mention"]');
    await expect(mention).toHaveCount(1);
    await expect(page.locator('.side-panel .mention-chip--agent')).toHaveCount(0);
    expect(await mention.evaluate((el) => el.tagName)).toBe('SPAN');
  });

  test('F-E7: skill/project/machine mentions stay lazy spans (literal negative cases)', async ({ page }) => {
    await page.goto(SCENARIO);
    await expect(page.getByTestId('home-c')).toBeVisible();
    const stream = page.getByTestId('chief-stream');
    for (const kind of ['skill', 'project', 'machine'] as const) {
      const chip = stream.locator(`.mention-chip--${kind}`);
      await expect(chip, kind).toHaveCount(1);
      expect(await chip.evaluate((el) => el.tagName), kind).toBe('SPAN');
      await expect(chip, kind).not.toHaveAttribute('href', /.*/);
    }

    await expect(stream.locator('a[data-slot="task-mention"]')).toHaveAttribute(
      'href',
      /^\/app\?(scenario=[^&]+&)?thread=r3-legacy-1$/,
    );
  });
});

test.describe('lazy face zero change (#741 negative case)', () => {
  test('F-E8: robot rows without an agent projection carry no face, and only the task links (frozen capture face r5 114)', async ({
    page,
  }) => {
    await stubDicebear(page);
    await page.goto('/app?scenario=114');
    await expect(page.getByTestId('home-c')).toBeVisible();
    const stream = page.getByTestId('chief-stream');

    await expect(stream.getByTestId('chief-msg').locator('> svg')).toHaveCount(0);

    const links = stream.getByRole('link');
    await expect(links).toHaveCount(2);
    for (const link of await links.all())
      await expect(link).toHaveAttribute('href', /[?&]thread=r3-contributing$/);
    await expect(stream).not.toContainText('r5-scribe');
  });
});
