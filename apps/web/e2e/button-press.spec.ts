import { expect, type Locator, type Page, test } from '@playwright/test';

const SURFACES = [
  '/app?scenario=home-c',
  '/app?scenario=home-c&pane=tasks',
  '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16',
];

async function press(page: Page, control: Locator) {
  const box = await control.boundingBox();
  if (box === null) throw new Error('control has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
  const resting = await control.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.mouse.down();
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
    const buttons = page.locator('[data-slot="button"]:visible');
    await expect(buttons.first()).toBeVisible();
    const handles = (await buttons.elementHandles()).slice(0, 30);
    expect(handles.length).toBeGreaterThan(3);
    const moved: string[] = [];
    for (const handle of handles) {
      const box = await handle.boundingBox();
      if (box === null) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const state = await handle.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          label: el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.tagName,
          transform: style.transform,
          translate: style.translate,
        };
      });
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await page.keyboard.press('Escape');
      if (state.transform !== 'none' || state.translate !== 'none') moved.push(JSON.stringify(state));
    }
    expect(moved).toEqual([]);
  });
}

test('a pressed ghost button lays a tint over its own background at once, with no transition', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app?scenario=home-c');
  const control = page.getByTestId('home-c-pane-buttons').getByRole('button', { name: '任务' });
  const { resting, pressed } = await press(page, control);
  expect(pressed.shadow).not.toBe(resting);
  expect(pressed.shadow).toContain('inset');
  expect(pressed.duration).toBe('0s');
  expect(pressed.transform).toBe('none');
});
