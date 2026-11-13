import { expect, type Locator, type Page, test } from '@playwright/test';

const SURFACES = [
  '/app?scenario=home-c',
  '/app?scenario=home-c&pane=tasks',
  '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16',
];

async function press(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (box === null) throw new Error('control has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const resting = await control.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.mouse.down();
  expect(await control.evaluate((el) => el.matches(':active')), 'the control is pressed').toBe(true);
  const pressed = await control.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      transform: style.transform,
      translate: style.translate,
      shadow: style.boxShadow,
      duration: style.transitionDuration,
    };
  });
  await page.mouse.move(0, 0);
  await page.mouse.up();
  return { resting, pressed };
}

for (const surface of SURFACES) {
  test(`a pressed button never moves on ${surface}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(surface);
    const buttons = page.locator('button:is([data-slot="button"], [data-slot="tooltip-trigger"]):visible');
    await expect(buttons.first()).toBeVisible();
    const total = Math.min(await buttons.count(), 30);
    expect(total).toBeGreaterThan(3);
    const landed = page.url();
    const moved: string[] = [];
    let pressedCount = 0;
    for (let index = 0; index < total; index++) {
      if (page.url() !== landed) {
        await page.goto(surface);
        await expect(buttons.first()).toBeVisible();
      }
      const handle = await buttons.nth(index).elementHandle({ timeout: 2000 }).catch(() => null);
      if (handle === null) continue;
      const attached = await handle.scrollIntoViewIfNeeded().then(
        () => true,
        () => false,
      );
      if (!attached) continue;
      const box = await handle.boundingBox();
      if (box === null) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const state = await handle.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          active: el.matches(':active'),
          label: el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.tagName,
          transform: style.transform,
          translate: style.translate,
        };
      });
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await page.keyboard.press('Escape');
      if (state.active) pressedCount++;
      if (state.transform !== 'none' || state.translate !== 'none') moved.push(JSON.stringify(state));
    }
    expect(pressedCount).toBeGreaterThan(3);
    expect(moved).toEqual([]);
  });
}

test('a pressed conversation pane button stays flat with no transition', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app?scenario=home-c');
  const control = page.getByTestId('home-c-pane-buttons').getByRole('button', { name: '任务' });
  const { resting, pressed } = await press(page, control);
  expect(resting).toBe('none');
  expect(pressed.shadow).toBe('none');
  expect(pressed.duration).toBe('0s');
  expect(pressed.transform).toBe('none');
});
