import { expect, type Page, test } from '@playwright/test';

const SCENARIO = '/app/schedules?scenario=chief-agent-chip';

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
    const drawer = page.locator('.chief-drawer');
    await expect(drawer).toBeVisible();
    await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  });

  test('no avatar or agent-name link sits above a Coordinator reply', async ({ page }) => {
    const stream = page.getByTestId('chief-stream');
    await expect(stream.getByTestId('chief-msg-col').first()).toBeVisible();
    await expect(stream.getByRole('link', { name: 'r3-builder' })).toHaveCount(0);
    await expect(stream.getByTestId('chief-msg-col').locator('a[href$="/agents/r3-builder"]')).toHaveCount(0);
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

  test('F-E6: side chat transcript face follows the same law (second consumer of the single-source segments)', async ({ page }) => {
    await page.goto('/app/todo/r3-legacy-1?scenario=chief-agent-chip');

    const chip = page.locator('.side-panel .mention-chip--agent');
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
      /^\/app\?(scenario=[^&]+&)?thread=r3-legacy-1$/,
    );
  });
});

test.describe('lazy face zero change (#741 negative case)', () => {
  test('F-E8: robot rows without an agent projection carry no face and zero anchors (frozen capture face r5 114)', async ({
    page,
  }) => {
    await stubDicebear(page);
    await page.goto('/app/schedules?scenario=114');
    await expect(page.locator('.chief-drawer')).toBeVisible();
    const stream = page.getByTestId('chief-stream');

    await expect(stream.getByTestId('chief-msg').locator('> svg')).toHaveCount(0);

    await expect(stream.getByRole('link')).toHaveCount(0);
    await expect(
      stream.getByTestId('chief-msg').filter({ has: page.getByRole('link') }),
    ).toHaveCount(0);
  });
});
