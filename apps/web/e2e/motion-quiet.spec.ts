import { expect, type Page, test } from '@playwright/test';

const THREAD = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16';

function probeAnimation(page: Page, slot: string, state: 'open' | 'closed'): Promise<string> {
  return page.evaluate(
    ({ slot, state }) => {
      const el = document.createElement('div');
      el.setAttribute('data-slot', slot);
      el.setAttribute(`data-${state}`, '');
      el.className =
        state === 'open' ? 'animate-in fade-in-0 zoom-in-95' : 'animate-out fade-out-0 zoom-out-95';
      document.body.append(el);
      const name = getComputedStyle(el).animationName;
      el.remove();
      return name;
    },
    { slot, state },
  );
}

test('a sent user message lands without an entry animation', async ({ page }) => {
  await page.goto(THREAD);
  const bubble = page.locator('.chat-bubble').first();
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('the composer ring follows hover and focus with no transition', async ({ page }) => {
  await page.goto(THREAD);
  const composer = page.locator('.composer').first();
  await expect(composer).toBeVisible();
  expect(await composer.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});

test('the coordinator composer ring follows hover and focus with no transition', async ({
  page,
}) => {
  await page.goto('/app?scenario=chief-working');
  const composer = page.locator('.chief-composer').first();
  await expect(composer).toBeVisible();
  expect(await composer.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
});

for (const slot of [
  'dropdown-menu-content',
  'dropdown-menu-sub-content',
  'popover-content',
  'select-content',
  'tooltip-content',
]) {
  test(`${slot} animates in and closes instantly`, async ({ page }) => {
    await page.goto(THREAD);
    expect(await probeAnimation(page, slot, 'open')).not.toBe('none');
    expect(await probeAnimation(page, slot, 'closed')).toBe('none');
  });
}

test('dialogs keep their exit animation', async ({ page }) => {
  await page.goto(THREAD);
  expect(await probeAnimation(page, 'dialog-content', 'closed')).not.toBe('none');
});

test('a docked side panel opens instantly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app?scenario=home-c&pane=tasks');
  const panel = page.locator('aside.side-panel');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('a floating side panel still slides in over the scrim', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/app?scenario=home-c&pane=tasks');
  const panel = page.locator('aside.side-panel');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => getComputedStyle(el).animationName)).toBe('side-panel-in');
});

const PRESS_SURFACES = [
  '/app?scenario=home-c',
  '/app?scenario=home-c&pane=tasks',
  '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16',
];

for (const surface of PRESS_SURFACES) {
  test(`pressing a control does not dim or fade it on ${surface}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(surface);
    await expect(page.locator('button:visible').first()).toBeVisible();
    const controls = page.locator('button:visible, a[href]:visible, [role="button"]:visible');
    const handles = (await controls.elementHandles()).slice(0, 40);
    expect(handles.length).toBeGreaterThan(5);
    const dimmed: string[] = [];
    for (const control of handles) {
      const box = await control.boundingBox();
      if (box === null) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(250);
      const resting = await control.evaluate((el) => getComputedStyle(el).opacity);
      await page.mouse.down();
      const sample = await control.evaluate(async (el) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const opacityAnimations = el
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .filter((animation) => (animation as CSSTransition).transitionProperty === 'opacity');
        return {
          label: `${el.tagName.toLowerCase()}[${el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? ''}]`,
          opacity: getComputedStyle(el).opacity,
          fading: opacityAnimations.length,
        };
      });
      await page.mouse.move(0, 0);
      await page.mouse.up();
      if (sample.opacity !== resting || sample.fading > 0) dimmed.push(JSON.stringify(sample));
      await page.keyboard.press('Escape');
    }
    expect(dimmed).toEqual([]);
  });
}
