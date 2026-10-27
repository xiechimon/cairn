import { expect, type Page, test } from '@playwright/test';

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
  );
}

/** Resolve a declaration through the token path the card consumes. */
async function resolveVar(page: Page, prop: string, value: string) {
  return page.evaluate(
    ([p, v]) => {
      const probe = document.createElement('div');
      probe.style.setProperty(p, v);
      document.body.append(probe);
      const resolved = getComputedStyle(probe).getPropertyValue(p).trim();
      probe.remove();
      return resolved;
    },
    [prop, value] as const,
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`press tints the whole card one surface step (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01&view=board');
    const card = page.locator('[data-column="done"] [data-todo-id]').first();
    const box = await card.boundingBox();
    if (box == null) throw new Error('done card missing');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const restBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    const expectedPress = await resolveVar(page, 'background-color', 'var(--surface-press)');
    // the resting face must not already sit on the press tier
    expect(restBg).not.toBe(expectedPress);

    await page.mouse.move(cx, cy);

    const expectedHover = await resolveVar(page, 'background-color', 'var(--card-hover)');
    expect(restBg).not.toBe(expectedHover);
    expect(expectedHover).not.toBe(expectedPress);
    await expect(card).toHaveCSS('background-color', expectedHover);
    await page.mouse.down();
    await expect(card).toHaveCSS('background-color', expectedPress);
    // single feedback: the stretched link does NOT dim under the global a:active
    const linkOpacity = await card
      .getByRole('link')
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(linkOpacity).toBe('1');

    await page.mouse.move(cx, cy + box.height + 40, { steps: 6 });
    await page.mouse.up();
    await settleFrames(page);
    await expect(card).toHaveCSS('background-color', restBg);
  });
}

test('card face is selection- and native-drag-locked (no `小链接` anywhere)', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const card = page.locator('[data-column="done"] [data-todo-id]').first();
  await expect(card).toHaveCSS('user-select', 'none');
  const link = card.getByRole('link');
  await expect(link).toHaveAttribute('draggable', 'false');
  const userDrag = await link.evaluate((el) => getComputedStyle(el).webkitUserDrag);
  expect(userDrag).toBe('none');

  // press-and-move over the card: zero NATIVE dragstart, zero selection —
  // and since #753 the dnd overlay DOES rise (done cards arm the board
  // gesture; the two "drag ghosts" are different mechanisms and the #629
  // lock is about the native one only)
  await page.evaluate(() => {
    (window as unknown as { __dragstarts: number }).__dragstarts = 0;
    document.addEventListener(
      'dragstart',
      () => {
        (window as unknown as { __dragstarts: number }).__dragstarts += 1;
      },
      true,
    );
  });
  const box = await card.boundingBox();
  if (box == null) throw new Error('done card missing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + i * 6, cy + i * 3, { steps: 2 });
  }
  const mid = await page.evaluate(() => ({
    dragstarts: (window as unknown as { __dragstarts: number }).__dragstarts,
    selection: window.getSelection()?.toString() ?? '',
  }));
  expect(mid.dragstarts).toBe(0);
  expect(mid.selection).toBe('');
  await expect(page.getByTestId('drag-overlay').locator('[data-todo-id]')).toBeVisible();
  // release OUTSIDE the card bounds but inside the source column: a press
  // that travels and lifts off the card is an aborted gesture, not a click
  // (up inside the card bounds is the browser's click law — that face is
  // pinned by the navigate test below); the same-column drop commits nothing
  await page.mouse.move(cx, cy + box.height, { steps: 6 });
  await page.mouse.up();
  await settleFrames(page);
  await page.waitForTimeout(300);
  expect(new URL(page.url()).pathname).toBe('/app');
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
});

test('plain click on a done card opens it in the task panel and the card stays a link (#1937)', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const card = page.locator('[data-column="done"] [data-todo-id]').first();
  const id = await card.getAttribute('data-todo-id');
  await expect(card.locator('a.todo-card-link')).toHaveAttribute('href', new RegExp(`/app/todo/${id}`));
  await card.click();
  await page.waitForURL((u) => u.searchParams.get('task') === id);
  expect(new URL(page.url()).pathname).toBe('/app');
  await expect(page.getByRole('complementary', { name: '任务面板' })).toBeVisible();
});
