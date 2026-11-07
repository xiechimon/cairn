import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

const MINUTE = 60_000;

test('the jump-to-latest button is 36px', async ({ page }) => {
  const now = Date.now();
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index} ${'filler '.repeat(30)}`,
    createdAt: now - (40 - index) * MINUTE,
  }));
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    return json({ messages, nextCursor: null });
  });
  await page.goto('/app');
  const home = page.getByTestId('home-c');
  await expect(home.getByTestId('chief-msg').last()).toBeVisible();
  await home.getByTestId('chief-body').evaluate((node) => node.scrollTo({ top: 0 }));
  const jump = home.getByTestId('jump-to-latest');
  await expect(jump).toHaveAttribute('data-active', 'true');
  const box = await jump.boundingBox();
  expect(box?.width).toBe(36);
  expect(box?.height).toBe(36);
});

test('reply headings are 15px and 600 like the body, not larger', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: [] }, (path, route, json) => {
    if (path !== `/api/conversations/${THREAD.id}/messages`) return undefined;
    if (route.request().method() !== 'GET') return undefined;
    return json({
      messages: [
        { id: 'u', role: 'user', content: 'report', createdAt: 1 },
        { id: 'a', role: 'assistant', content: '## Findings\n\nBody text.\n\n### Detail\n\nMore.', createdAt: 2 },
      ],
      nextCursor: null,
    });
  });
  await page.goto('/app');
  for (const level of ['h2', 'h3']) {
    const face = await page
      .getByTestId('home-c')
      .locator(`${level}.chat-md-head`)
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { size: style.fontSize, weight: style.fontWeight };
      });
    expect(face).toEqual({ size: '15px', weight: '600' });
  }
});

test('the quick-start chips are quiet bordered pills at least 32px high with an icon', async ({
  page,
}) => {
  await mockLive(page, { threads: [], messages: [], todos: [] });
  await page.goto('/app');
  const chips = page.getByTestId('home-c-starters').getByRole('button');
  await expect(chips).toHaveCount(4);
  for (const index of [0, 1, 2, 3]) {
    const chip = chips.nth(index);
    const box = await chip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
    await expect(chip.locator('svg')).toHaveCount(1);
    const face = await chip.evaluate((node) => {
      const style = getComputedStyle(node);
      return { border: style.borderTopWidth, radius: style.borderTopLeftRadius };
    });
    expect(face.border).toBe('1px');
    expect(Number.parseFloat(face.radius)).toBeGreaterThanOrEqual(16);
  }
});
